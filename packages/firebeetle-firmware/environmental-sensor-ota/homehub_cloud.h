#pragma once

#include <Arduino.h>

struct CloudReading {
  float temperatureC = 0.0f;
  float humidity = 0.0f;
  uint16_t pressureHpa = 0;
  float lightLux = 0.0f;
  float uvMwCm2 = 0.0f;
  uint16_t vocIndex = 0;
  float batteryV = 0.0f;
  int batteryPercent = 0;
  bool vocValid = false;
};

struct CloudSettings {
  uint32_t reportingIntervalSeconds = 300;
  bool maintenanceMode = false;
};

bool homehubCloudConfigured();
bool homehubCloudEnsureTime();
bool homehubCloudFetchSettings(CloudSettings& settings);
bool homehubCloudPublish(const CloudReading& reading);
String homehubCloudNowIso();
int homehubCloudLastConnectError();
