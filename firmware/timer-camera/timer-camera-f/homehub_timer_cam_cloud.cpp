#include "homehub_timer_cam_cloud.h"

#include "homehub_s3_put.h"

#include <ArduinoJson.h>
#include <ArduinoMqttClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <sys/time.h>
#include <time.h>

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#elif __has_include("iot_config.h")
#include "iot_config.h"
#endif

namespace {

constexpr uint32_t kMqttTimeoutMs = 15000;
constexpr uint32_t kShadowRefreshMs = 60000;

#ifdef HOMEHUB_IOT_ENABLED
WiFiClientSecure secureClient;
MqttClient mqttClient(secureClient);
unsigned long lastShadowGetMs = 0;
unsigned long lastCredentialsPrimeMs = 0;
String lastError;
bool settingsNeedStore = false;
bool reportShadow = false;
SemaphoreHandle_t cloudMutex = nullptr;

class CloudLock {
 public:
  explicit CloudLock(TickType_t wait) {
    if (!cloudMutex) cloudMutex = xSemaphoreCreateMutex();
    held_ = cloudMutex && xSemaphoreTake(cloudMutex, wait) == pdTRUE;
  }
  ~CloudLock() {
    if (held_) xSemaphoreGive(cloudMutex);
  }
  explicit operator bool() const { return held_; }

 private:
  bool held_ = false;
};

String shadowGetTopic() { return String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/get"; }
String shadowGetAccepted() {
  return String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/get/accepted";
}
String shadowUpdateTopic() { return String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/update"; }
String shadowDeltaTopic() {
  return String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/update/delta";
}

void applyShadowDocument(const String& payload, TimerCamSettings& settings) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    return;
  }
  JsonVariant configuration = doc["state"]["desired"]["configuration"];
  if (configuration.isNull()) {
    configuration = doc["state"]["configuration"];
  }
  if (timerCamSettingsApplyJson(configuration, settings)) {
    settingsNeedStore = true;
    reportShadow = true;
  }
}

String incomingShadow;
bool incomingShadowReady = false;

void onMqttMessage(int messageSize) {
  incomingShadow = "";
  incomingShadow.reserve(static_cast<size_t>(messageSize > 0 ? messageSize : 256));
  while (mqttClient.available()) {
    incomingShadow += static_cast<char>(mqttClient.read());
  }
  incomingShadowReady = incomingShadow.length() > 0;
}

bool connectMqtt() {
  if (mqttClient.connected()) {
    return true;
  }
  if (secureClient.connected()) {
    secureClient.stop();
  }
  secureClient.setCACert(HOMEHUB_AWS_ROOT_CA);
  secureClient.setCertificate(HOMEHUB_DEVICE_CERT);
  secureClient.setPrivateKey(HOMEHUB_DEVICE_KEY);
  mqttClient.setId(HOMEHUB_THING_NAME);
  mqttClient.setConnectionTimeout(kMqttTimeoutMs);
  mqttClient.onMessage(onMqttMessage);
  if (!mqttClient.connect(HOMEHUB_IOT_ENDPOINT, 8883)) {
    lastError = String("mqtt-") + mqttClient.connectError();
    return false;
  }
  mqttClient.subscribe(shadowGetAccepted());
  mqttClient.subscribe(shadowDeltaTopic());
  lastError = "";
  return true;
}

void requestShadow() {
  mqttClient.beginMessage(shadowGetTopic().c_str(), 2, false, 0);
  mqttClient.print("{}");
  mqttClient.endMessage();
  lastShadowGetMs = millis();
}

void publishReported(const TimerCamSettings& settings) {
  JsonDocument doc;
  JsonObject reported = doc["state"]["reported"].to<JsonObject>();
  reported["type"] = "camera";
  JsonObject configuration = reported["configuration"].to<JsonObject>();
  JsonDocument settingsDoc;
  timerCamSettingsToJson(settings, settingsDoc);
  for (JsonPair kv : settingsDoc.as<JsonObject>()) {
    configuration[kv.key()] = kv.value();
  }
  String payload;
  serializeJson(doc, payload);
  mqttClient.beginMessage(shadowUpdateTopic().c_str(), payload.length(), false, 0);
  mqttClient.print(payload);
  mqttClient.endMessage();
}

void drainMqtt(TimerCamSettings& settings) {
  mqttClient.poll();
  if (incomingShadowReady) {
    incomingShadowReady = false;
    applyShadowDocument(incomingShadow, settings);
  }
}

#endif

}  // namespace

bool homehubCloudConfigured() {
#ifdef HOMEHUB_IOT_ENABLED
  return true;
#else
  return false;
#endif
}

bool homehubCloudEnsureTime() {
  if (time(nullptr) > 1700000000) {
    return true;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  for (int attempt = 0; attempt < 40; ++attempt) {
    if (time(nullptr) > 1700000000) {
      return true;
    }
    delay(250);
  }
  return false;
}

String homehubCloudNowIso() {
  struct timeval tv {};
  gettimeofday(&tv, nullptr);
  time_t now = tv.tv_sec;
  struct tm utc {};
  gmtime_r(&now, &utc);
  char buffer[32];
  char base[24];
  strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &utc);
  snprintf(buffer, sizeof(buffer), "%s.%03ldZ", base, tv.tv_usec / 1000L);
  return String(buffer);
}

String homehubCloudSnapshotKey(const String& recordedAt) {
#ifdef HOMEHUB_IOT_ENABLED
  String stamp = recordedAt;
  stamp.replace(":", "");
  stamp.replace("+00:00", "Z");
  return String("snapshots/") + HOMEHUB_THING_NAME + "/" + stamp + ".jpg";
#else
  (void)recordedAt;
  return "";
#endif
}

void homehubCloudBegin(TimerCamSettings& settings) {
#ifdef HOMEHUB_IOT_ENABLED
  CloudLock lock(portMAX_DELAY);
  if (!lock) return;
  if (WiFi.status() != WL_CONNECTED || !homehubCloudEnsureTime()) {
    return;
  }
  homehubS3PrimeCredentials();
  lastCredentialsPrimeMs = millis();
  if (!connectMqtt()) {
    return;
  }
  requestShadow();
  const unsigned long deadline = millis() + 4000;
  while (millis() < deadline) {
    drainMqtt(settings);
    mqttClient.poll();
    delay(10);
  }
  if (settingsNeedStore) {
    timerCamSettingsStore(settings);
    settingsNeedStore = false;
  }
  if (reportShadow) {
    publishReported(settings);
    reportShadow = false;
  }
#else
  (void)settings;
#endif
}

void homehubCloudPoll(TimerCamSettings& settings) {
#ifdef HOMEHUB_IOT_ENABLED
  CloudLock lock(0);
  if (!lock) return;
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  if (!connectMqtt()) {
    return;
  }
  if (millis() - lastCredentialsPrimeMs >= 60000) {
    lastCredentialsPrimeMs = millis();
    homehubS3PrimeCredentials();
  }
  mqttClient.poll();
  drainMqtt(settings);
  if (settingsNeedStore) {
    timerCamSettingsStore(settings);
    settingsNeedStore = false;
  }
  if (reportShadow) {
    publishReported(settings);
    reportShadow = false;
  }
  if (millis() - lastShadowGetMs >= kShadowRefreshMs) {
    requestShadow();
  }
#else
  (void)settings;
#endif
}

void homehubCloudReportSettings(const TimerCamSettings& settings) {
#ifdef HOMEHUB_IOT_ENABLED
  CloudLock lock(pdMS_TO_TICKS(250));
  if (!lock) return;
  if (!connectMqtt()) {
    return;
  }
  publishReported(settings);
#else
  (void)settings;
#endif
}

bool homehubCloudMqttConnected() {
#ifdef HOMEHUB_IOT_ENABLED
  return mqttClient.connected();
#else
  return false;
#endif
}

String homehubCloudLastError() {
#ifdef HOMEHUB_IOT_ENABLED
  if (lastError.length() > 0) {
    return lastError;
  }
#endif
  return homehubS3LastError();
}

bool homehubCloudPublishCapture(const uint8_t* jpeg, size_t length, bool occupied,
                               const char* reason, float batteryVoltage, int batteryPercent,
                               String& snapshotKey, String& error) {
#ifdef HOMEHUB_IOT_ENABLED
  CloudLock lock(portMAX_DELAY);
  if (!lock) {
    error = "cloud-lock";
    return false;
  }
  if (!homehubCloudEnsureTime()) {
    error = lastError = "ntp";
    return false;
  }
  const String recordedAt = homehubCloudNowIso();
  snapshotKey = "";
  if (jpeg && length > 0) {
    // ESP32 cannot keep the MQTT TLS socket open while opening S3.
    if (mqttClient.connected()) {
      mqttClient.stop();
    }
    if (secureClient.connected()) {
      secureClient.stop();
    }
    vTaskDelay(pdMS_TO_TICKS(50));
    snapshotKey = homehubCloudSnapshotKey(recordedAt);
    if (!homehubS3PutJpeg(jpeg, length, snapshotKey, error)) {
      lastError = error;
      return false;
    }
  }

  if (!connectMqtt()) {
    error = lastError;
    return false;
  }

  JsonDocument doc;
  doc["deviceId"] = HOMEHUB_DEVICE_ID;
  doc["hubId"] = HOMEHUB_HUB_ID;
  doc["thingName"] = HOMEHUB_THING_NAME;
  doc["recordedAt"] = recordedAt;
  if (snapshotKey.length() > 0) {
    doc["snapshotKey"] = snapshotKey;
  }
  JsonObject metrics = doc["metrics"].to<JsonObject>();
  metrics["occupied"] = occupied;
  if (batteryVoltage > 0.1f) {
    metrics["batteryVoltage"] = batteryVoltage;
    metrics["batteryPercent"] = batteryPercent;
  }
  if (reason) {
    doc["reason"] = reason;
  }
  String payload;
  serializeJson(doc, payload);
  const String topic =
      String("homehub/") + HOMEHUB_STAGE + "/devices/" + HOMEHUB_DEVICE_ID + "/telemetry";
  mqttClient.beginMessage(topic.c_str(), payload.length(), false, 1);
  mqttClient.print(payload);
  if (!mqttClient.endMessage()) {
    error = lastError = "telemetry-publish";
    return false;
  }
  lastError = "";
  error = "";
  return true;
#else
  (void)jpeg;
  (void)length;
  (void)occupied;
  (void)reason;
  (void)batteryVoltage;
  (void)batteryPercent;
  snapshotKey = "";
  error = "cloud-disabled";
  return false;
#endif
}
