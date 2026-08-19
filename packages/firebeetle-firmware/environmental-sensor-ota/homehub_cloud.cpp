#include "homehub_cloud.h"

#include <ArduinoJson.h>
#include <ArduinoMqttClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#elif __has_include("iot_config.h")
#include "iot_config.h"
#endif

namespace {

constexpr uint32_t kDefaultReportingSeconds = 300;
constexpr uint32_t kMinReportingSeconds = 60;
constexpr uint32_t kMaxReportingSeconds = 3600;
constexpr uint32_t kMqttTimeoutMs = 15000;

Preferences prefs;
WiFiClientSecure secureClient;
MqttClient mqttClient(secureClient);
String shadowAcceptedPayload;
bool shadowReceived = false;

bool cloudEnabled() {
#ifdef HOMEHUB_IOT_ENABLED
  return true;
#else
  return false;
#endif
}

uint32_t clampReportingSeconds(uint32_t seconds) {
  if (seconds < kMinReportingSeconds) {
    return kMinReportingSeconds;
  }
  if (seconds > kMaxReportingSeconds) {
    return kMaxReportingSeconds;
  }
  return seconds;
}

void loadStoredReportingInterval(CloudSettings& settings) {
  prefs.begin("homehub", true);
  settings.reportingIntervalSeconds =
      clampReportingSeconds(prefs.getUInt("reportSec", kDefaultReportingSeconds));
  settings.maintenanceMode = prefs.getBool("maint", false);
  prefs.end();
}

void storeReportingInterval(uint32_t seconds) {
  prefs.begin("homehub", false);
  prefs.putUInt("reportSec", clampReportingSeconds(seconds));
  prefs.end();
}

void storeMaintenanceMode(bool enabled) {
  prefs.begin("homehub", false);
  prefs.putBool("maint", enabled);
  prefs.end();
}

void onMqttMessage(int messageSize) {
  (void)messageSize;
  shadowAcceptedPayload = "";
  while (mqttClient.available()) {
    shadowAcceptedPayload += static_cast<char>(mqttClient.read());
  }
  shadowReceived = true;
}

bool connectMqtt() {
#ifdef HOMEHUB_IOT_ENABLED
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
    Serial.print("MQTT connect failed, error=");
    Serial.println(mqttClient.connectError());
    return false;
  }
  return true;
#else
  return false;
#endif
}

void disconnectMqtt() {
  if (mqttClient.connected()) {
    mqttClient.stop();
  }
}

bool waitForShadowAccepted() {
  const unsigned long deadline = millis() + kMqttTimeoutMs;
  while (millis() < deadline) {
    mqttClient.poll();
    if (shadowReceived) {
      return true;
    }
    delay(10);
  }
  return false;
}

bool applyShadowPayload(const String& payload, CloudSettings& settings) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    return false;
  }
  JsonVariant desired = doc["state"]["desired"]["configuration"];
  if (desired.isNull()) {
    desired = doc["state"]["reported"]["configuration"];
  }
  if (desired.isNull()) {
    return false;
  }
  if (desired["reportingIntervalSeconds"].is<uint32_t>()) {
    settings.reportingIntervalSeconds =
        clampReportingSeconds(desired["reportingIntervalSeconds"].as<uint32_t>());
    storeReportingInterval(settings.reportingIntervalSeconds);
  }
  if (desired["maintenanceMode"].is<bool>()) {
    settings.maintenanceMode = desired["maintenanceMode"].as<bool>();
    storeMaintenanceMode(settings.maintenanceMode);
  }
  return true;
}

}  // namespace

bool homehubCloudConfigured() { return cloudEnabled(); }

bool homehubCloudEnsureTime() {
  if (time(nullptr) > 1700000000) {
    return true;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  for (int attempt = 0; attempt < 30; ++attempt) {
    if (time(nullptr) > 1700000000) {
      return true;
    }
    delay(200);
  }
  return false;
}

String homehubCloudNowIso() {
  time_t now = time(nullptr);
  struct tm utc {};
  gmtime_r(&now, &utc);
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buffer);
}

bool homehubCloudFetchSettings(CloudSettings& settings) {
  loadStoredReportingInterval(settings);
  if (!cloudEnabled() || WiFi.status() != WL_CONNECTED) {
    return false;
  }
  if (!homehubCloudEnsureTime()) {
    return false;
  }
  if (!connectMqtt()) {
    return false;
  }

#ifdef HOMEHUB_IOT_ENABLED
  const String getTopic = String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/get";
  const String acceptedFilter =
      String("$aws/things/") + HOMEHUB_THING_NAME + "/shadow/get/accepted";
  shadowAcceptedPayload = "";
  shadowReceived = false;
  mqttClient.subscribe(acceptedFilter);
  mqttClient.beginMessage(getTopic.c_str(), 2, false, 0);
  mqttClient.print("{}");
  if (!mqttClient.endMessage()) {
    Serial.println("MQTT shadow get failed");
    disconnectMqtt();
    return false;
  }
  if (waitForShadowAccepted()) {
    applyShadowPayload(shadowAcceptedPayload, settings);
  }
#endif

  disconnectMqtt();
  return true;
}

bool homehubCloudPublish(const CloudReading& reading) {
  if (!cloudEnabled() || WiFi.status() != WL_CONNECTED) {
    return false;
  }
  if (!homehubCloudEnsureTime()) {
    return false;
  }
  if (!connectMqtt()) {
    return false;
  }

#ifdef HOMEHUB_IOT_ENABLED
  JsonDocument doc;
  doc["deviceId"] = HOMEHUB_DEVICE_ID;
  doc["hubId"] = HOMEHUB_HUB_ID;
  doc["thingName"] = HOMEHUB_THING_NAME;
  doc["recordedAt"] = homehubCloudNowIso();
  JsonObject metrics = doc["metrics"].to<JsonObject>();
  metrics["temperature"] = reading.temperatureC;
  metrics["humidity"] = reading.humidity;
  metrics["pressureHpa"] = reading.pressureHpa;
  metrics["lightLux"] = reading.lightLux;
  metrics["uvMwCm2"] = reading.uvMwCm2;
  metrics["batteryVoltage"] = reading.batteryV;
  metrics["batteryPercent"] = reading.batteryPercent;
  if (reading.vocValid) {
    metrics["vocIndex"] = reading.vocIndex;
  }

  String payload;
  serializeJson(doc, payload);
  const String topic =
      String("homehub/devices/") + HOMEHUB_DEVICE_ID + "/telemetry";
  mqttClient.beginMessage(topic.c_str(), payload.length(), false, 1);
  mqttClient.print(payload);
  if (!mqttClient.endMessage()) {
    Serial.println("MQTT publish failed");
    disconnectMqtt();
    return false;
  }

  const unsigned long deadline = millis() + 2000;
  while (millis() < deadline) {
    mqttClient.poll();
    delay(10);
  }
#endif

  disconnectMqtt();
  return true;
}

int homehubCloudLastConnectError() { return mqttClient.connectError(); }
