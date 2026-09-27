#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_camera.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <soc/rtc_cntl_reg.h>
#include <soc/soc.h>

#include "homehub_timer_cam_cloud.h"
#include "homehub_timer_cam_settings.h"

#ifndef WIFI_SSID
#define WIFI_SSID "REPLACE_ME"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "REPLACE_ME"
#endif
#ifndef DEVICE_HOSTNAME
#define DEVICE_HOSTNAME "homehub-tcf"
#endif
#ifndef DEVICE_LABEL
#define DEVICE_LABEL "TimerCAM-F"
#endif
#ifndef OTA_PASSWORD
#define OTA_PASSWORD ""
#endif

// Timer Camera F Grove HY2.0-4P: Unit PIR digital out is the white wire (SCL).
constexpr int kPirGpio = 13;
constexpr int kLedGpio = 2;
constexpr int kBatHoldGpio = 33;
constexpr int kBatAdcGpio = 38;
constexpr float kBatDivider = 1.51f;
constexpr float kBatFullV = 4.20f;
constexpr float kBatEmptyV = 3.30f;
constexpr size_t kMaxJpegBytes = 200 * 1024;
constexpr uint32_t kHealthIntervalMs = 60000;

WebServer statusServer(80);
TimerCamSettings settings;
bool cameraReady = false;
bool lastPirHigh = false;
unsigned long lastMotionCaptureMs = 0;
unsigned long nextIntervalMs = 0;
unsigned long lastStatusLogMs = 0;
unsigned long lastHealthMs = 0;
String lastError;
String lastCaptureReason;
String lastSnapshotKey;
size_t lastJpegBytes = 0;
uint8_t* lastJpeg = nullptr;
framesize_t appliedFrameSize = FRAMESIZE_QVGA;
int appliedJpegQuality = 12;
QueueHandle_t uploadQueue = nullptr;
QueueHandle_t uploadResultQueue = nullptr;

struct UploadJob {
  uint8_t* jpeg;
  size_t length;
  bool occupied;
  float batteryVoltage;
  int batteryPercent;
  char reason[20];
};

struct UploadResult {
  bool success;
  char snapshotKey[192];
  char error[64];
};

static void holdPower() {
  pinMode(kBatHoldGpio, OUTPUT);
  digitalWrite(kBatHoldGpio, HIGH);
}

static void setLed(bool on) { digitalWrite(kLedGpio, on ? HIGH : LOW); }

static float readBatteryVoltage() {
  analogSetPinAttenuation(kBatAdcGpio, ADC_11db);
  long sumMv = 0;
  for (int i = 0; i < 8; i++) {
    sumMv += analogReadMilliVolts(kBatAdcGpio);
    delay(2);
  }
  return (sumMv / 8.0f) * kBatDivider / 1000.0f;
}

static int batteryPercent(float voltage) {
  if (voltage >= kBatFullV) return 100;
  if (voltage <= kBatEmptyV) return 0;
  return static_cast<int>(((voltage - kBatEmptyV) / (kBatFullV - kBatEmptyV)) * 100.0f);
}

static void printMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  Serial.printf("MAC: %02x:%02x:%02x:%02x:%02x:%02x\n", mac[0], mac[1], mac[2], mac[3],
                mac[4], mac[5]);
}

static void applySensorTuning() {
  sensor_t* sensor = esp_camera_sensor_get();
  if (!sensor) {
    return;
  }
  sensor->set_brightness(sensor, settings.brightness);
  sensor->set_saturation(sensor, settings.saturation);
  sensor->set_contrast(sensor, settings.contrast);
  sensor->set_vflip(sensor, settings.vflip ? 1 : 0);
  sensor->set_hmirror(sensor, settings.hmirror ? 1 : 0);
}

static bool initializeCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 32;
  config.pin_d1 = 35;
  config.pin_d2 = 34;
  config.pin_d3 = 5;
  config.pin_d4 = 39;
  config.pin_d5 = 18;
  config.pin_d6 = 36;
  config.pin_d7 = 19;
  config.pin_xclk = 27;
  config.pin_pclk = 21;
  config.pin_vsync = 22;
  config.pin_href = 26;
  config.pin_sccb_sda = 25;
  config.pin_sccb_scl = 23;
  config.pin_pwdn = -1;
  config.pin_reset = 15;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = settings.frameSize;
  config.jpeg_quality = settings.jpegQuality;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = psramFound() ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

  if (esp_camera_init(&config) != ESP_OK) {
    lastError = "camera-init";
    return false;
  }
  applySensorTuning();
  camera_fb_t* warmup = esp_camera_fb_get();
  if (warmup) {
    esp_camera_fb_return(warmup);
  }
  appliedFrameSize = settings.frameSize;
  appliedJpegQuality = settings.jpegQuality;
  lastError = "";
  return true;
}

static bool ensureCameraSettings() {
  const bool needReinit =
      !cameraReady || appliedFrameSize != settings.frameSize ||
      appliedJpegQuality != settings.jpegQuality;
  if (needReinit) {
    if (cameraReady) {
      esp_camera_deinit();
      cameraReady = false;
    }
    cameraReady = initializeCamera();
    return cameraReady;
  }
  applySensorTuning();
  return cameraReady;
}

static bool storeJpeg(const uint8_t* data, size_t length) {
  if (!data || length == 0 || length > kMaxJpegBytes) {
    return false;
  }
  if (lastJpeg) {
    free(lastJpeg);
    lastJpeg = nullptr;
  }
  lastJpeg = static_cast<uint8_t*>(psramFound() ? ps_malloc(length) : malloc(length));
  if (!lastJpeg) {
    lastError = "jpeg-alloc";
    lastJpegBytes = 0;
    return false;
  }
  memcpy(lastJpeg, data, length);
  lastJpegBytes = length;
  return true;
}

static bool captureJpeg(const char* reason) {
  if (!ensureCameraSettings()) {
    lastError = "camera-not-ready";
    return false;
  }
  setLed(true);
  camera_fb_t* frame = esp_camera_fb_get();
  if (!frame) {
    lastError = "camera-capture";
    setLed(false);
    return false;
  }
  sensor_t* sensor = esp_camera_sensor_get();
  bool usedFallback = false;
  if (frame->len > kMaxJpegBytes && sensor) {
    esp_camera_fb_return(frame);
    sensor->set_quality(sensor, settings.jpegQuality < 20 ? 20 : settings.jpegQuality);
    delay(80);
    frame = esp_camera_fb_get();
    usedFallback = true;
  }
  if (frame && frame->len > kMaxJpegBytes && sensor) {
    esp_camera_fb_return(frame);
    sensor->set_framesize(sensor, FRAMESIZE_VGA);
    sensor->set_quality(sensor, 24);
    delay(80);
    frame = esp_camera_fb_get();
    usedFallback = true;
  }
  if (!frame) {
    lastError = "camera-capture";
    setLed(false);
    return false;
  }
  const bool ok = frame->format == PIXFORMAT_JPEG && storeJpeg(frame->buf, frame->len);
  if (!ok) {
    lastError = frame->len > kMaxJpegBytes ? "jpeg-too-large" : "jpeg-invalid";
  }
  if (ok) {
    lastCaptureReason = reason;
    lastError = "";
    Serial.printf("Captured %s JPEG %u bytes\n", reason, static_cast<unsigned>(lastJpegBytes));
  }
  esp_camera_fb_return(frame);
  if (usedFallback && sensor) {
    sensor->set_framesize(sensor, settings.frameSize);
    sensor->set_quality(sensor, settings.jpegQuality);
  }
  setLed(false);
  return ok;
}

static void uploadWorker(void*) {
  UploadJob job {};
  for (;;) {
    if (xQueueReceive(uploadQueue, &job, portMAX_DELAY) != pdTRUE) continue;
    String error;
    String snapshotKey;
    bool success = false;
    for (int attempt = 0; attempt < 3 && !success; ++attempt) {
      success = homehubCloudPublishCapture(job.jpeg, job.length, job.occupied, job.reason,
                                           job.batteryVoltage, job.batteryPercent, snapshotKey,
                                           error);
      if (!success) vTaskDelay(pdMS_TO_TICKS(1000U << attempt));
    }
    if (job.jpeg) free(job.jpeg);
    UploadResult result {};
    result.success = success;
    strlcpy(result.snapshotKey, snapshotKey.c_str(), sizeof(result.snapshotKey));
    strlcpy(result.error, error.c_str(), sizeof(result.error));
    xQueueSend(uploadResultQueue, &result, 0);
    // Let the core's idle task run between queued TLS jobs so the watchdog is fed.
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

static void drainUploadResults() {
  UploadResult result {};
  while (xQueueReceive(uploadResultQueue, &result, 0) == pdTRUE) {
    if (result.success) {
      if (result.snapshotKey[0]) lastSnapshotKey = result.snapshotKey;
      lastError = "";
      if (result.snapshotKey[0]) Serial.printf("Uploaded %s\n", result.snapshotKey);
    } else {
      lastError = result.error[0] ? result.error : "upload-failed";
      Serial.printf("Cloud publish failed: %s\n", lastError.c_str());
    }
  }
}

static bool queueCloudPublish(const uint8_t* jpeg, size_t length, bool occupied,
                              const char* reason) {
  if (!homehubCloudConfigured()) {
    return true;
  }
  if (!uploadQueue) {
    lastError = "upload-worker";
    return false;
  }
  UploadJob job {};
  if (jpeg && length) {
    job.jpeg = static_cast<uint8_t*>(psramFound() ? ps_malloc(length) : malloc(length));
    if (!job.jpeg) {
      lastError = "upload-alloc";
      return false;
    }
    memcpy(job.jpeg, jpeg, length);
    job.length = length;
  }
  const float batteryV = readBatteryVoltage();
  job.occupied = occupied;
  job.batteryVoltage = batteryV;
  job.batteryPercent = batteryPercent(batteryV);
  strlcpy(job.reason, reason ? reason : "capture", sizeof(job.reason));
  if (xQueueSend(uploadQueue, &job, 0) != pdTRUE) {
    if (job.jpeg) free(job.jpeg);
    lastError = "upload-queue-full";
    return false;
  }
  return true;
}

static void publishHealth(bool occupied) {
  queueCloudPublish(nullptr, 0, occupied, "heartbeat");
}

static bool pirHigh() { return digitalRead(kPirGpio) == HIGH; }

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
    Serial.print(".");
  }
  Serial.println();
  return false;
}

static void setupOta() {
  ArduinoOTA.setHostname(DEVICE_HOSTNAME);
  if (strlen(OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(OTA_PASSWORD);
  }
  ArduinoOTA.onStart([]() {
    Serial.println("OTA update started");
    statusServer.stop();
    if (cameraReady) {
      esp_camera_deinit();
      cameraReady = false;
    }
  });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA update finished"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("OTA progress: %u%%\r", progress / (total / 100));
  });
  ArduinoOTA.onError([](ota_error_t error) { Serial.printf("OTA error[%u]\n", error); });
  ArduinoOTA.setPort(3232);
  ArduinoOTA.begin();
  Serial.printf("OTA listening on %s:3232\n", WiFi.localIP().toString().c_str());
}

static bool authorizeHttp() {
  if (strlen(OTA_PASSWORD) > 0 &&
      statusServer.authenticate("homehub", OTA_PASSWORD)) {
    return true;
  }
  statusServer.requestAuthentication(BASIC_AUTH, "HomeHub Camera");
  return false;
}

static void handleStatus() {
  if (!authorizeHttp()) return;
  String body = "{";
  body += "\"device\":\"";
  body += DEVICE_LABEL;
  body += "\",\"hostname\":\"";
  body += DEVICE_HOSTNAME;
  body += "\",\"ip\":\"";
  body += WiFi.localIP().toString();
  body += "\",\"cameraReady\":";
  body += cameraReady ? "true" : "false";
  body += ",\"psram\":";
  body += psramFound() ? "true" : "false";
  body += ",\"pirGpio\":";
  body += String(kPirGpio);
  body += ",\"motionActive\":";
  body += pirHigh() ? "true" : "false";
  body += ",\"lastJpegBytes\":";
  body += String(lastJpegBytes);
  body += ",\"lastCaptureReason\":\"";
  body += lastCaptureReason;
  body += "\",\"lastSnapshotKey\":\"";
  body += lastSnapshotKey;
  const float batteryV = readBatteryVoltage();
  body += "\",\"batteryVoltage\":";
  body += String(batteryV, 2);
  body += ",\"batteryPercent\":";
  body += String(batteryPercent(batteryV));
  body += ",\"cloud\":";
  body += homehubCloudConfigured() ? "true" : "false";
  body += ",\"mqtt\":";
  body += homehubCloudMqttConnected() ? "true" : "false";
  body += ",\"lastError\":\"";
  body += lastError.length() ? lastError : homehubCloudLastError();
  body += "\",\"ota\":true}";
  statusServer.send(200, "application/json", body);
}

static void handleSnapshot() {
  if (!authorizeHttp()) return;
  if (!lastJpeg || lastJpegBytes == 0) {
    statusServer.send(404, "text/plain", "no snapshot yet");
    return;
  }
  statusServer.setContentLength(lastJpegBytes);
  statusServer.send(200, "image/jpeg", "");
  statusServer.client().write(lastJpeg, lastJpegBytes);
}

static void handleCapture() {
  if (!authorizeHttp()) return;
  if (!captureJpeg("manual")) {
    statusServer.send(500, "text/plain", lastError);
    return;
  }
  queueCloudPublish(lastJpeg, lastJpegBytes, false, "manual");
  handleStatus();
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  holdPower();
  pinMode(kLedGpio, OUTPUT);
  setLed(false);
  pinMode(kPirGpio, INPUT_PULLDOWN);

  Serial.begin(115200);
  delay(1200);
  Serial.println();
  Serial.print("Device: ");
  Serial.println(DEVICE_LABEL);
  Serial.print("Hostname: ");
  Serial.println(DEVICE_HOSTNAME);
  printMacAddress();
  Serial.printf("PIR GPIO %d (Grove white / SCL)\n", kPirGpio);

  timerCamSettingsLoad(settings);

  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);
  if (!ensureWifi()) {
    Serial.println("Wi-Fi failed — OTA unavailable until reconnect.");
  } else {
    Serial.println();
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    if (!MDNS.begin(DEVICE_HOSTNAME)) {
      Serial.println("mDNS start failed");
    }
    setupOta();
    Serial.println("Ready for OTA");
    Serial.println("Status: http://" + WiFi.localIP().toString() + "/status");
    homehubCloudBegin(settings);
  }

  cameraReady = initializeCamera();
  Serial.println(cameraReady ? "Camera ready" : "Camera init failed");
  uploadQueue = xQueueCreate(3, sizeof(UploadJob));
  uploadResultQueue = xQueueCreate(3, sizeof(UploadResult));
  if (!uploadQueue || !uploadResultQueue ||
      // ESP-IDF HTTP is task-safe; low priority preserves both idle watchdog tasks.
      xTaskCreatePinnedToCore(uploadWorker, "camera-upload", 16384, nullptr, 0, nullptr, 1) !=
          pdPASS) {
    lastError = "upload-worker";
  }
  statusServer.on("/status", handleStatus);
  statusServer.on("/snapshot", handleSnapshot);
  statusServer.on("/capture", handleCapture);
  statusServer.begin();
  nextIntervalMs = millis() + (settings.reportingIntervalSeconds * 1000UL);
}

void loop() {
  ArduinoOTA.handle();
  statusServer.handleClient();
  drainUploadResults();
  homehubCloudPoll(settings);
  ensureCameraSettings();

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(100);
    return;
  }

  const unsigned long now = millis();
  const uint32_t intervalMs = settings.reportingIntervalSeconds * 1000UL;
  const uint32_t cooldownMs = settings.motionCooldownSeconds * 1000UL;
  const bool intervalDue = static_cast<long>(now - nextIntervalMs) >= 0;
  const bool high = pirHigh();
  const bool cooldownOk = (now - lastMotionCaptureMs) >= cooldownMs;
  const bool motionEdge = high && !lastPirHigh && cooldownOk;
  const bool motionClear = !high && lastPirHigh;
  lastPirHigh = high;

  if (now - lastHealthMs >= kHealthIntervalMs) {
    lastHealthMs = now;
    publishHealth(high);
  }

  bool captured = false;
  bool occupied = false;
  const char* reason = "interval";

  if (timerCamSettingsWantMotion(settings) && motionEdge) {
    lastMotionCaptureMs = now;
    // Tell HomeHub immediately. The JPEG upload is slower and follows after.
    queueCloudPublish(nullptr, 0, true, "motion");
  } else if (timerCamSettingsWantMotion(settings) && motionClear) {
    queueCloudPublish(nullptr, 0, false, "clear");
  }

  if (settings.captureNowPending) {
    reason = "captureNow";
    occupied = high;
    captured = captureJpeg(reason);
    if (captured && queueCloudPublish(lastJpeg, lastJpegBytes, occupied, reason)) {
      settings.captureNowPending = false;
      homehubCloudReportSettings(settings);
    }
  } else if (timerCamSettingsWantMotion(settings) && motionEdge) {
    reason = "motion";
    occupied = true;
    captured = captureJpeg(reason);
    if (captured) {
      queueCloudPublish(lastJpeg, lastJpegBytes, true, reason);
    }
  } else if (timerCamSettingsWantInterval(settings) && intervalDue) {
    reason = "interval";
    occupied = false;
    captured = captureJpeg(reason);
    if (captured) {
      queueCloudPublish(lastJpeg, lastJpegBytes, false, reason);
    }
  }

  if (captured || intervalDue) {
    nextIntervalMs = now + intervalMs;
  }

  if (now - lastStatusLogMs >= 10000) {
    lastStatusLogMs = now;
    Serial.printf("IP %s PIR %s mqtt %s last %s %u bytes\n",
                  WiFi.localIP().toString().c_str(), high ? "HIGH" : "LOW",
                  homehubCloudMqttConnected() ? "up" : "down", lastCaptureReason.c_str(),
                  static_cast<unsigned>(lastJpegBytes));
  }
  delay(10);
}
