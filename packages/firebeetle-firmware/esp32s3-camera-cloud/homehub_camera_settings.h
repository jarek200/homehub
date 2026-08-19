#pragma once

#include <ArduinoJson.h>
#include <esp_camera.h>
#include <WString.h>

struct CameraSettings {
  uint32_t reportingIntervalSeconds = 30;
  framesize_t frameSize = FRAMESIZE_QVGA;
  int jpegQuality = 12;
  int brightness = 1;
  int saturation = -2;
  int contrast = 0;
  bool vflip = true;
  bool hmirror = false;
  bool motionEnabled = true;
  uint32_t motionCooldownSeconds = 15;
  // both | interval | motion
  String captureMode = "both";
  // always-on | sleep-motion
  String powerMode = "always-on";
  bool maintenanceMode = false;
};

bool cameraSettingsSleepMotion(const CameraSettings& settings);

bool cameraSettingsLoad(CameraSettings& settings);
bool cameraSettingsFetchFromShadow(CameraSettings& settings);
bool cameraSettingsApply(CameraSettings& settings, bool& cameraReady);
String cameraSettingsFrameSizeId(framesize_t frameSize);
framesize_t cameraSettingsFrameSizeFromId(const char* value);
void cameraSettingsToJson(const CameraSettings& settings, JsonDocument& document);
