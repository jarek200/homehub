#pragma once

#include <ArduinoJson.h>
#include <WString.h>
#include <esp_camera.h>

struct TimerCamSettings {
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
  String captureMode = "both";
  String powerMode = "always-on";
  bool maintenanceMode = false;
  String captureNow;
  bool captureNowPending = false;
};

void timerCamSettingsLoad(TimerCamSettings& settings);
void timerCamSettingsStore(const TimerCamSettings& settings);
bool timerCamSettingsApplyJson(JsonVariant desired, TimerCamSettings& settings);
String timerCamSettingsFrameSizeId(framesize_t frameSize);
framesize_t timerCamSettingsFrameSizeFromId(const char* value);
void timerCamSettingsToJson(const TimerCamSettings& settings, JsonDocument& document);
bool timerCamSettingsWantInterval(const TimerCamSettings& settings);
bool timerCamSettingsWantMotion(const TimerCamSettings& settings);
