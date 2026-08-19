#pragma once

#include <Arduino.h>
#include <Wire.h>

bool sgp40Begin();
void sgp40SetRhT(float relativeHumidity, float temperatureC);
bool sgp40MeasureRawCompensated(uint16_t* rawOut);
bool sgp40MeasureRawLowPower(uint16_t* rawOut);
