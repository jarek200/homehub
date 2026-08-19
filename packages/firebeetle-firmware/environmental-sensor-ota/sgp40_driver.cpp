#include "sgp40_driver.h"

namespace {

constexpr uint8_t kSgp40Address = 0x59;
constexpr uint16_t kMeasureTestOk = 0xD400;

constexpr uint8_t kCmdMeasureTest[] = {0x28, 0x0E};
constexpr uint8_t kCmdMeasureRaw[] = {0x26, 0x0F};

float gRelativeHumidity = 50.0f;
float gTemperatureC = 25.0f;
uint8_t gRhTemData[8] = {0};

uint8_t sgp40Crc(uint8_t data1, uint8_t data2) {
  uint8_t crc = 0xFF;
  const uint8_t data[2] = {data1, data2};
  for (int i = 0; i < 2; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 8; bit > 0; --bit) {
      if (crc & 0x80) {
        crc = static_cast<uint8_t>((crc << 1) ^ 0x31u);
      } else {
        crc = static_cast<uint8_t>(crc << 1);
      }
    }
  }
  return crc;
}

void sgp40TransformRhT() {
  const uint16_t rhTicks =
      static_cast<uint16_t>((gRelativeHumidity * 65535.0f) / 100.0f + 0.5f);
  const uint16_t tempTicks =
      static_cast<uint16_t>((gTemperatureC + 45.0f) * (65535.0f / 175.0f) + 0.5f);

  gRhTemData[0] = kCmdMeasureRaw[0];
  gRhTemData[1] = kCmdMeasureRaw[1];
  gRhTemData[2] = static_cast<uint8_t>(rhTicks >> 8);
  gRhTemData[3] = static_cast<uint8_t>(rhTicks & 0xFF);
  gRhTemData[4] = sgp40Crc(gRhTemData[2], gRhTemData[3]);
  gRhTemData[5] = static_cast<uint8_t>(tempTicks >> 8);
  gRhTemData[6] = static_cast<uint8_t>(tempTicks & 0xFF);
  gRhTemData[7] = sgp40Crc(gRhTemData[5], gRhTemData[6]);
}

bool sgp40Write(const uint8_t* cmd, size_t len) {
  Wire.beginTransmission(kSgp40Address);
  for (size_t i = 0; i < len; ++i) {
    Wire.write(cmd[i]);
  }
  return Wire.endTransmission() == 0;
}

bool sgp40ReadRaw(uint16_t* rawOut) {
  if (!rawOut) {
    return false;
  }
  if (Wire.requestFrom(kSgp40Address, static_cast<uint8_t>(3)) != 3) {
    return false;
  }
  const uint8_t msb = Wire.read();
  const uint8_t lsb = Wire.read();
  Wire.read();  // CRC
  *rawOut = static_cast<uint16_t>((static_cast<uint16_t>(msb) << 8) | lsb);
  return true;
}

bool sgp40MeasureTest() {
  if (!sgp40Write(kCmdMeasureTest, sizeof(kCmdMeasureTest))) {
    return false;
  }
  delay(320);
  uint16_t result = 0;
  return sgp40ReadRaw(&result) && result == kMeasureTestOk;
}

}  // namespace

bool sgp40Begin() { return sgp40MeasureTest(); }

void sgp40SetRhT(float relativeHumidity, float temperatureC) {
  gRelativeHumidity = relativeHumidity;
  gTemperatureC = temperatureC;
  sgp40TransformRhT();
}

bool sgp40MeasureRawCompensated(uint16_t* rawOut) {
  if (!rawOut) {
    return false;
  }
  sgp40TransformRhT();
  if (!sgp40Write(gRhTemData, sizeof(gRhTemData))) {
    return false;
  }
  delay(30);
  return sgp40ReadRaw(rawOut);
}

bool sgp40MeasureRawLowPower(uint16_t* rawOut) {
  uint16_t ignored = 0;
  if (!sgp40MeasureRawCompensated(&ignored)) {
    return false;
  }
  delay(170);
  return sgp40MeasureRawCompensated(rawOut);
}
