#include <ArduinoJson.h>
#include <ArduinoMqttClient.h>
#include <ArduinoOTA.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_camera.h>
#include <esp_sleep.h>
#include <mbedtls/base64.h>
#include <time.h>

#include "homehub_camera_settings.h"
#include "homehub_pir.h"

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#elif __has_include("iot_config.h")
#include "iot_config.h"
#else
#error "Generate iot_config.h with scripts/provision-esp-iot.sh"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "REPLACE_ME"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "REPLACE_ME"
#endif
#ifndef DEVICE_HOSTNAME
#define DEVICE_HOSTNAME "homehub-s3-camera"
#endif
#ifndef OTA_PASSWORD
#define OTA_PASSWORD ""
#endif

constexpr size_t kMaxJpegBytes = 90 * 1024;
constexpr uint32_t kMqttTimeoutMs = 15000;
constexpr uint32_t kSettingsRefreshMs = 60000;
constexpr uint32_t kSleepMaintenanceMinSeconds = 60;

WiFiClientSecure secureClient;
MqttClient mqttClient(secureClient);
WebServer statusServer(80);
CameraSettings settings;
unsigned long nextCaptureMs = 0;
unsigned long nextSettingsRefreshMs = 0;
bool cameraReady = false;
bool sleepMotionMode = false;
bool maintenanceMode = false;
bool lastPublishSucceeded = false;
String lastError;
size_t lastJpegBytes = 0;
size_t lastPayloadBytes = 0;
bool lastPirHigh = false;
unsigned long lastMotionCaptureMs = 0;
String lastCaptureReason;
String lastWakeReason;

static void initializeOta() {
  ArduinoOTA.setHostname(DEVICE_HOSTNAME);
  if (strlen(OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(OTA_PASSWORD);
  }
  ArduinoOTA.begin();
}

static bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int attempt = 0; attempt < 80; ++attempt) {
    if (WiFi.status() == WL_CONNECTED) {
      return true;
    }
    delay(250);
  }
  return false;
}

static bool ensureTime() {
  if (time(nullptr) > 1700000000) {
    return true;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  for (int attempt = 0; attempt < 50; ++attempt) {
    ArduinoOTA.handle();
    statusServer.handleClient();
    if (time(nullptr) > 1700000000) {
      return true;
    }
    delay(200);
  }
  lastError = "ntp";
  return false;
}

static String nowIso() {
  time_t now = time(nullptr);
  struct tm utc = {};
  gmtime_r(&now, &utc);
  char buffer[24];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buffer);
}

static bool connectMqtt() {
  secureClient.stop();
  secureClient.setCACert(HOMEHUB_AWS_ROOT_CA);
  secureClient.setCertificate(HOMEHUB_DEVICE_CERT);
  secureClient.setPrivateKey(HOMEHUB_DEVICE_KEY);
  mqttClient.setId(HOMEHUB_THING_NAME);
  mqttClient.setConnectionTimeout(kMqttTimeoutMs);
  if (!mqttClient.connect(HOMEHUB_IOT_ENDPOINT, 8883)) {
    lastError = String("mqtt-connect-") + mqttClient.connectError();
    return false;
  }
  return true;
}

static bool publishSnapshot() {
  camera_fb_t* frame = esp_camera_fb_get();
  if (!frame) {
    lastError = "camera-capture";
    return false;
  }
  lastJpegBytes = frame->len;
  if (frame->format != PIXFORMAT_JPEG || frame->len > kMaxJpegBytes) {
    lastError = "jpeg-invalid";
    esp_camera_fb_return(frame);
    return false;
  }

  const size_t capacity = 4 * ((frame->len + 2) / 3);
  unsigned char* encoded = static_cast<unsigned char*>(
      psramFound() ? ps_malloc(capacity + 1) : malloc(capacity + 1));
  if (!encoded) {
    lastError = "snapshot-allocation";
    esp_camera_fb_return(frame);
    return false;
  }
  size_t encodedLength = 0;
  const int result =
      mbedtls_base64_encode(encoded, capacity + 1, &encodedLength, frame->buf, frame->len);
  esp_camera_fb_return(frame);
  if (result != 0) {
    lastError = String("base64-") + result;
    free(encoded);
    return false;
  }

  const String prefix =
      String("{\"hubId\":\"") + HOMEHUB_HUB_ID + "\",\"thingName\":\"" +
      HOMEHUB_THING_NAME + "\",\"recordedAt\":\"" + nowIso() +
      "\",\"contentType\":\"image/jpeg\",\"imageBase64\":\"";
  const String suffix = "\"}";
  lastPayloadBytes = prefix.length() + encodedLength + suffix.length();
  const String topic = String("homehub/devices/") + HOMEHUB_DEVICE_ID + "/snapshot";

  mqttClient.beginMessage(topic.c_str(), lastPayloadBytes, false, 1);
  mqttClient.print(prefix);
  mqttClient.write(encoded, encodedLength);
  mqttClient.print(suffix);
  lastPublishSucceeded = mqttClient.endMessage() == 1;
  lastError = lastPublishSucceeded ? "" : "mqtt-publish";
  free(encoded);
  return lastPublishSucceeded;
}

static bool runCloudCycle() {
  if (WiFi.status() != WL_CONNECTED || !cameraReady || !ensureTime() || !connectMqtt()) {
    return false;
  }
  const bool published = publishSnapshot();
  mqttClient.stop();
  return published;
}

static bool shouldCapture(bool intervalDue, bool* motionTriggered) {
  *motionTriggered = false;
  if (!settings.motionEnabled) {
    if (settings.captureMode == "motion") {
      return false;
    }
    return intervalDue;
  }

  const bool pirHigh = homehubPirRead();
  const unsigned long now = millis();
  const bool cooldownOk =
      (now - lastMotionCaptureMs) >= settings.motionCooldownSeconds * 1000UL;
  const bool motionEdge = pirHigh && !lastPirHigh && cooldownOk;
  lastPirHigh = pirHigh;
  if (motionEdge) {
    *motionTriggered = true;
  }

  if (settings.captureMode == "motion") {
    return motionEdge;
  }
  if (settings.captureMode == "interval") {
    return intervalDue;
  }
  return intervalDue || motionEdge;
}

static void refreshSettingsIfDue() {
  if (static_cast<long>(millis() - nextSettingsRefreshMs) < 0) {
    return;
  }
  nextSettingsRefreshMs = millis() + kSettingsRefreshMs;
  CameraSettings next = settings;
  if (cameraSettingsFetchFromShadow(next)) {
    const bool changed =
        next.reportingIntervalSeconds != settings.reportingIntervalSeconds ||
        next.frameSize != settings.frameSize || next.jpegQuality != settings.jpegQuality ||
        next.brightness != settings.brightness || next.saturation != settings.saturation ||
        next.contrast != settings.contrast || next.vflip != settings.vflip ||
        next.hmirror != settings.hmirror || next.motionEnabled != settings.motionEnabled ||
        next.motionCooldownSeconds != settings.motionCooldownSeconds ||
        next.captureMode != settings.captureMode || next.powerMode != settings.powerMode ||
        next.maintenanceMode != settings.maintenanceMode;
    if (changed) {
      settings = next;
      cameraSettingsApply(settings, cameraReady);
    }
  }
  maintenanceMode = settings.maintenanceMode;
  sleepMotionMode = cameraSettingsSleepMotion(settings) && !maintenanceMode;
}

static void handleStatus() {
  JsonDocument document;
  document["deviceId"] = HOMEHUB_DEVICE_ID;
  document["cameraReady"] = cameraReady;
  document["psram"] = psramFound();
  document["lastPublishSucceeded"] = lastPublishSucceeded;
  document["lastError"] = lastError;
  document["lastJpegBytes"] = lastJpegBytes;
  document["lastPayloadBytes"] = lastPayloadBytes;
  document["lastCaptureReason"] = lastCaptureReason;
  document["lastWakeReason"] = lastWakeReason;
  document["sleepMotionMode"] = sleepMotionMode;
  cameraSettingsToJson(settings, document);
  homehubPirToJson(document, homehubPirRead(), lastMotionCaptureMs);
  String body;
  serializeJson(document, body);
  statusServer.send(200, "application/json", body);
}

static bool shouldCaptureOnSleepWake() {
  if (!settings.motionEnabled) {
    return false;
  }
  const esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (homehubPirWakeupWasMotion()) {
    lastWakeReason = "motion";
    return true;
  }
  if (cause == ESP_SLEEP_WAKEUP_UNDEFINED && homehubPirRead()) {
    lastWakeReason = "boot-motion";
    return true;
  }
  if (homehubPirWakeupWasTimer() && homehubPirRead()) {
    lastWakeReason = "timer-motion";
    return true;
  }
  if (homehubPirWakeupWasTimer()) {
    lastWakeReason = "timer";
  } else if (cause == ESP_SLEEP_WAKEUP_UNDEFINED) {
    lastWakeReason = "boot";
  } else {
    lastWakeReason = "unknown";
  }
  return false;
}

static void powerDownForSleep() {
  if (cameraReady) {
    esp_camera_deinit();
    cameraReady = false;
  }
  statusServer.stop();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

static void runSleepMotionCycle() {
  if (!ensureWifi()) {
    homehubPirLightSleep(kSleepMaintenanceMinSeconds);
    return;
  }

  statusServer.begin();
  CameraSettings next = settings;
  if (cameraSettingsFetchFromShadow(next)) {
    settings = next;
  }
  maintenanceMode = settings.maintenanceMode;
  if (maintenanceMode) {
    sleepMotionMode = false;
    if (!cameraReady) {
      cameraSettingsApply(settings, cameraReady);
    }
    nextCaptureMs = millis();
    nextSettingsRefreshMs = millis() + kSettingsRefreshMs;
    return;
  }
  if (!cameraSettingsSleepMotion(settings)) {
    sleepMotionMode = false;
    if (!cameraReady) {
      cameraSettingsApply(settings, cameraReady);
    }
    nextCaptureMs = millis();
    nextSettingsRefreshMs = millis() + kSettingsRefreshMs;
    return;
  }

  if (shouldCaptureOnSleepWake()) {
    lastCaptureReason = "motion";
    if (!cameraReady) {
      cameraSettingsApply(settings, cameraReady);
    }
    runCloudCycle();
    lastMotionCaptureMs = millis();
    homehubPirWaitUntilLow(15000);
    delay(settings.motionCooldownSeconds * 1000UL);
  }

  const uint32_t maintenanceWakeSeconds =
      settings.reportingIntervalSeconds < kSleepMaintenanceMinSeconds
          ? kSleepMaintenanceMinSeconds
          : settings.reportingIntervalSeconds;
  powerDownForSleep();
  homehubPirLightSleep(maintenanceWakeSeconds);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  cameraSettingsLoad(settings);
  homehubPirBegin();
  ensureWifi();

  initializeOta();
  statusServer.on("/status", handleStatus);
  statusServer.begin();
  cameraSettingsFetchFromShadow(settings);
  maintenanceMode = settings.maintenanceMode;
  sleepMotionMode = cameraSettingsSleepMotion(settings) && !maintenanceMode;

  if (!sleepMotionMode) {
    cameraSettingsApply(settings, cameraReady);
    nextCaptureMs = millis();
    nextSettingsRefreshMs = millis() + kSettingsRefreshMs;
  }
}

void loop() {
  if (sleepMotionMode) {
    runSleepMotionCycle();
    return;
  }

  ArduinoOTA.handle();
  statusServer.handleClient();
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(100);
    return;
  }
  refreshSettingsIfDue();
  const bool intervalDue = static_cast<long>(millis() - nextCaptureMs) >= 0;
  bool motionTriggered = false;
  if (shouldCapture(intervalDue, &motionTriggered)) {
    lastCaptureReason = motionTriggered ? "motion" : "interval";
    const bool published = runCloudCycle();
    if (motionTriggered) {
      lastMotionCaptureMs = millis();
    }
    if (intervalDue || motionTriggered) {
      const uint32_t retrySeconds = published ? settings.reportingIntervalSeconds : 10;
      nextCaptureMs = millis() + retrySeconds * 1000UL;
    }
  }
  delay(10);
}
