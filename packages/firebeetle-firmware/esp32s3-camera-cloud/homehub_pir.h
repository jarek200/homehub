#pragma once

#include <ArduinoJson.h>

// DFR1154 Gravity port pin 44 (blue wire) — PIR signal.
constexpr int kPirGpio = 44;

void homehubPirBegin();
bool homehubPirRead();
void homehubPirToJson(JsonDocument& document, bool motionActive, unsigned long lastMotionCaptureMs);
