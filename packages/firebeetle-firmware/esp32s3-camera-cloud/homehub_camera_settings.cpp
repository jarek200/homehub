#include "homehub_camera_settings.h"

#include <ArduinoJson.h>
#include <cstring>
#include <ArduinoMqttClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#elif __has_include("iot_config.h")
#include "iot_config.h"
#endif

namespace {

constexpr uint32_t kDefaultReportingSeconds = 30;
constexpr uint32_t kMinReportingSeconds = 15;
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
  if (seconds < kMinReportingSeconds) return kMinReportingSeconds;
  if (seconds > kMaxReportingSeconds) return kMaxReportingSeconds;
  return seconds;
}

int clampAdjust(int value) {
  if (value < -2) return -2;
  if (value > 2) return 2;
  return value;
}

int clampQuality(int value) {
  if (value < 4) return 4;
  if (value > 63) return 63;
  return value;
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
  return mqttClient.connect(HOMEHUB_IOT_ENDPOINT, 8883);
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

bool applyConfigurationJson(JsonVariant desired, CameraSettings& settings) {
  if (desired.isNull()) {
    return false;
  }
  bool changed = false;
  if (desired["reportingIntervalSeconds"].is<uint32_t>()) {
    const uint32_t next =
        clampReportingSeconds(desired["reportingIntervalSeconds"].as<uint32_t>());
    if (settings.reportingIntervalSeconds != next) {
      settings.reportingIntervalSeconds = next;
      changed = true;
    }
  }
  if (desired["frameSize"].is<const char*>()) {
    const framesize_t next =
        cameraSettingsFrameSizeFromId(desired["frameSize"].as<const char*>());
    if (settings.frameSize != next) {
      settings.frameSize = next;
      changed = true;
    }
  }
  if (desired["jpegQuality"].is<int>()) {
    const int next = clampQuality(desired["jpegQuality"].as<int>());
    if (settings.jpegQuality != next) {
      settings.jpegQuality = next;
      changed = true;
    }
  }
  if (desired["brightness"].is<int>()) {
    const int next = clampAdjust(desired["brightness"].as<int>());
    if (settings.brightness != next) {
      settings.brightness = next;
      changed = true;
    }
  }
  if (desired["saturation"].is<int>()) {
    const int next = clampAdjust(desired["saturation"].as<int>());
    if (settings.saturation != next) {
      settings.saturation = next;
      changed = true;
    }
  }
  if (desired["contrast"].is<int>()) {
    const int next = clampAdjust(desired["contrast"].as<int>());
    if (settings.contrast != next) {
      settings.contrast = next;
      changed = true;
    }
  }
  if (desired["vflip"].is<bool>()) {
    const bool next = desired["vflip"].as<bool>();
    if (settings.vflip != next) {
      settings.vflip = next;
      changed = true;
    }
  }
  if (desired["hmirror"].is<bool>()) {
    const bool next = desired["hmirror"].as<bool>();
    if (settings.hmirror != next) {
      settings.hmirror = next;
      changed = true;
    }
  }
  return changed;
}

void storeSettings(const CameraSettings& settings) {
  prefs.begin("homehub", false);
  prefs.putUInt("reportSec", settings.reportingIntervalSeconds);
  prefs.putUChar("frameSize", static_cast<uint8_t>(settings.frameSize));
  prefs.putChar("jpegQ", static_cast<int8_t>(settings.jpegQuality));
  prefs.putChar("bright", static_cast<int8_t>(settings.brightness));
  prefs.putChar("sat", static_cast<int8_t>(settings.saturation));
  prefs.putChar("contrast", static_cast<int8_t>(settings.contrast));
  prefs.putBool("vflip", settings.vflip);
  prefs.putBool("hmirror", settings.hmirror);
  prefs.end();
}

}  // namespace

String cameraSettingsFrameSizeId(framesize_t frameSize) {
  switch (frameSize) {
    case FRAMESIZE_QQVGA: return "qqvga";
    case FRAMESIZE_QCIF: return "qcif";
    case FRAMESIZE_QVGA: return "qvga";
    case FRAMESIZE_CIF: return "cif";
    case FRAMESIZE_HVGA: return "hvga";
    case FRAMESIZE_VGA: return "vga";
    case FRAMESIZE_SVGA: return "svga";
    case FRAMESIZE_XGA: return "xga";
    case FRAMESIZE_HD: return "hd";
    case FRAMESIZE_SXGA: return "sxga";
    case FRAMESIZE_UXGA: return "uxga";
    default: return "qvga";
  }
}

framesize_t cameraSettingsFrameSizeFromId(const char* value) {
  if (!value) return FRAMESIZE_QVGA;
  if (strcmp(value, "qqvga") == 0) return FRAMESIZE_QQVGA;
  if (strcmp(value, "qcif") == 0) return FRAMESIZE_QCIF;
  if (strcmp(value, "qvga") == 0) return FRAMESIZE_QVGA;
  if (strcmp(value, "cif") == 0) return FRAMESIZE_CIF;
  if (strcmp(value, "hvga") == 0) return FRAMESIZE_HVGA;
  if (strcmp(value, "vga") == 0) return FRAMESIZE_VGA;
  if (strcmp(value, "svga") == 0) return FRAMESIZE_SVGA;
  if (strcmp(value, "xga") == 0) return FRAMESIZE_XGA;
  if (strcmp(value, "hd") == 0) return FRAMESIZE_HD;
  if (strcmp(value, "sxga") == 0) return FRAMESIZE_SXGA;
  if (strcmp(value, "uxga") == 0) return FRAMESIZE_UXGA;
  return FRAMESIZE_QVGA;
}

bool cameraSettingsLoad(CameraSettings& settings) {
  prefs.begin("homehub", true);
  settings.reportingIntervalSeconds =
      clampReportingSeconds(prefs.getUInt("reportSec", kDefaultReportingSeconds));
  settings.frameSize = static_cast<framesize_t>(prefs.getUChar("frameSize", FRAMESIZE_QVGA));
  settings.jpegQuality = clampQuality(prefs.getChar("jpegQ", 12));
  settings.brightness = clampAdjust(prefs.getChar("bright", 1));
  settings.saturation = clampAdjust(prefs.getChar("sat", -2));
  settings.contrast = clampAdjust(prefs.getChar("contrast", 0));
  settings.vflip = prefs.getBool("vflip", true);
  settings.hmirror = prefs.getBool("hmirror", false);
  prefs.end();
  return true;
}

bool cameraSettingsFetchFromShadow(CameraSettings& settings) {
  cameraSettingsLoad(settings);
  if (!cloudEnabled() || WiFi.status() != WL_CONNECTED) {
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
    disconnectMqtt();
    return false;
  }
  if (waitForShadowAccepted()) {
    JsonDocument doc;
    if (!deserializeJson(doc, shadowAcceptedPayload)) {
      JsonVariant desired = doc["state"]["desired"]["configuration"];
      if (desired.isNull()) {
        desired = doc["state"]["reported"]["configuration"];
      }
      if (applyConfigurationJson(desired, settings)) {
        storeSettings(settings);
      }
    }
  }
#endif

  disconnectMqtt();
  return true;
}

static bool initializeCameraWithSettings(const CameraSettings& settings) {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 16;
  config.pin_d1 = 18;
  config.pin_d2 = 21;
  config.pin_d3 = 17;
  config.pin_d4 = 14;
  config.pin_d5 = 7;
  config.pin_d6 = 6;
  config.pin_d7 = 4;
  config.pin_xclk = 5;
  config.pin_pclk = 15;
  config.pin_vsync = 1;
  config.pin_href = 2;
  config.pin_sccb_sda = 8;
  config.pin_sccb_scl = 9;
  config.pin_pwdn = -1;
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = settings.frameSize;
  config.jpeg_quality = settings.jpegQuality;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = psramFound() ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

  const esp_err_t result = esp_camera_init(&config);
  if (result != ESP_OK) {
    return false;
  }
  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_brightness(sensor, settings.brightness);
    sensor->set_saturation(sensor, settings.saturation);
    sensor->set_contrast(sensor, settings.contrast);
    sensor->set_vflip(sensor, settings.vflip ? 1 : 0);
    sensor->set_hmirror(sensor, settings.hmirror ? 1 : 0);
  }
  camera_fb_t* warmup = esp_camera_fb_get();
  if (warmup) {
    esp_camera_fb_return(warmup);
  }
  return true;
}

bool cameraSettingsApply(CameraSettings& settings, bool& cameraReady) {
  if (cameraReady) {
    esp_camera_deinit();
    cameraReady = false;
  }
  cameraReady = initializeCameraWithSettings(settings);
  return cameraReady;
}

void cameraSettingsToJson(const CameraSettings& settings, JsonDocument& document) {
  document["reportingIntervalSeconds"] = settings.reportingIntervalSeconds;
  document["frameSize"] = cameraSettingsFrameSizeId(settings.frameSize);
  document["jpegQuality"] = settings.jpegQuality;
  document["brightness"] = settings.brightness;
  document["saturation"] = settings.saturation;
  document["contrast"] = settings.contrast;
  document["vflip"] = settings.vflip;
  document["hmirror"] = settings.hmirror;
}
