#pragma once

#include "homehub_timer_cam_settings.h"

#include <stddef.h>
#include <stdint.h>
#include <WString.h>

bool homehubCloudConfigured();
bool homehubCloudEnsureTime();
String homehubCloudNowIso();
String homehubCloudSnapshotKey(const String& recordedAt);
void homehubCloudBegin(TimerCamSettings& settings);
void homehubCloudPoll(TimerCamSettings& settings);
bool homehubCloudPublishCapture(const uint8_t* jpeg, size_t length, bool occupied,
                               const char* reason, float batteryVoltage, int batteryPercent,
                               String& snapshotKey, String& error);
void homehubCloudReportSettings(const TimerCamSettings& settings);
bool homehubCloudMqttConnected();
String homehubCloudLastError();
