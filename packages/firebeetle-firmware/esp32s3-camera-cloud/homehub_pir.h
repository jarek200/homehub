#pragma once

#include <ArduinoJson.h>

// DFR1154 Gravity port pin 44 (blue wire) — PIR signal.
constexpr int kPirGpio = 44;

void homehubPirBegin();
bool homehubPirRead();
void homehubPirWaitUntilLow(uint32_t timeoutMs);
bool homehubPirWakeupWasMotion();
bool homehubPirWakeupWasTimer();
void homehubPirLightSleep(uint32_t timerWakeSeconds);
void homehubPirToJson(JsonDocument& document, bool motionActive, unsigned long lastMotionCaptureMs);
