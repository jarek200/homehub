#include <ArduinoOTA.h>
#include <DFRobot_EnvironmentalSensor.h>
#include <DFRobot_SGP40.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <cstring>

#ifndef WIFI_SSID
#define WIFI_SSID "REPLACE_ME"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "REPLACE_ME"
#endif
#ifndef DEVICE_HOSTNAME
#define DEVICE_HOSTNAME "homehub-esp"
#endif
#ifndef DEVICE_LABEL
#define DEVICE_LABEL "ESP32"
#endif
#ifndef OTA_PASSWORD
#define OTA_PASSWORD ""
#endif

// SEN0500/SEN0501: flip onboard switch to I2C and set MODESWITCH to 0.
#define MODESWITCH 0

#if MODESWITCH
#error "Set the sensor switch to I2C and MODESWITCH to 0 for Gravity IO shield wiring."
#else
DFRobot_EnvironmentalSensor environment(SEN050X_DEFAULT_DEVICE_ADDRESS, &Wire);
DFRobot_SGP40 airQuality(&Wire);
#endif

struct SensorReadings {
  bool valid = false;
  float temperatureC = 0.0f;
  float humidity = 0.0f;
  uint16_t pressureHpa = 0;
  float lightLux = 0.0f;
  float uvMwCm2 = 0.0f;
  bool vocReady = false;
  uint16_t vocIndex = 0;
  unsigned long updatedAtMs = 0;
};

SensorReadings latestReadings;
bool sensorReady = false;
bool vocReady = false;
bool vocWarming = false;
bool wireStarted = false;
unsigned long vocWarmupUntilMs = 0;

constexpr uint8_t kSensorI2cSdaPin = 21;
constexpr uint8_t kSensorI2cSclPin = 22;
constexpr uint8_t kEnvSensorAddress = 0x22;
constexpr uint8_t kVocSensorAddress = 0x59;
constexpr uint32_t kVocWarmupMs = 10000;

constexpr unsigned long kSensorReadIntervalMs = 5000;
constexpr unsigned long kStatusLogIntervalMs = 10000;
constexpr int kStatusLedPin = 2;  // FireBeetle ESP32-E onboard LED
constexpr unsigned long kDefaultIdentifyMs = 20000;

WebServer httpServer(80);

unsigned long identifyUntilMs = 0;
unsigned long identifyLastToggleMs = 0;
bool identifyLedOn = false;

static unsigned long identifyBlinkIntervalMs() {
  // Distinct patterns so boards are tell apart if both are triggered.
  if (strcmp(DEVICE_LABEL, "FireBeetle-1") == 0) {
    return 150;  // fast blink
  }
  if (strcmp(DEVICE_LABEL, "FireBeetle-2") == 0) {
    return 700;  // slow blink
  }
  return 300;
}

static const char* identifyPatternLabel() {
  if (strcmp(DEVICE_LABEL, "FireBeetle-1") == 0) {
    return "fast";
  }
  if (strcmp(DEVICE_LABEL, "FireBeetle-2") == 0) {
    return "slow";
  }
  return "medium";
}

static void setupStatusLed() {
  pinMode(kStatusLedPin, OUTPUT);
  digitalWrite(kStatusLedPin, LOW);
}

static void handleIdentifyLed() {
  const unsigned long now = millis();
  if (now >= identifyUntilMs) {
    if (identifyLedOn) {
      digitalWrite(kStatusLedPin, LOW);
      identifyLedOn = false;
    }
    return;
  }

  const unsigned long interval = identifyBlinkIntervalMs();
  if (now - identifyLastToggleMs >= interval) {
    identifyLastToggleMs = now;
    identifyLedOn = !identifyLedOn;
    digitalWrite(kStatusLedPin, identifyLedOn ? HIGH : LOW);
  }
}

static void startIdentify(unsigned long durationMs) {
  identifyUntilMs = millis() + durationMs;
  identifyLastToggleMs = 0;
  identifyLedOn = false;
  digitalWrite(kStatusLedPin, LOW);
  Serial.printf("Identify LED: %s blink for %lu ms\n", identifyPatternLabel(), durationMs);
}

static void handleIdentifyRequest() {
  unsigned long durationMs = kDefaultIdentifyMs;
  if (httpServer.hasArg("seconds")) {
    const long seconds = httpServer.arg("seconds").toInt();
    if (seconds > 0 && seconds <= 120) {
      durationMs = (unsigned long)seconds * 1000UL;
    }
  }
  startIdentify(durationMs);

  String body = "{\"device\":\"";
  body += DEVICE_LABEL;
  body += "\",\"hostname\":\"";
  body += DEVICE_HOSTNAME;
  body += "\",\"identifying\":true,\"pattern\":\"";
  body += identifyPatternLabel();
  body += "\",\"duration_ms\":";
  body += String(durationMs);
  body += "}";
  httpServer.send(200, "application/json", body);
}

#ifdef FIREBEETLE_BATTERY
constexpr int kBatteryAdcPin = 34;
constexpr float kBatteryDivider = 2.0f;
constexpr float kBatteryFullV = 4.20f;
constexpr float kBatteryEmptyV = 3.30f;
#endif

static float readBatteryVoltage() {
#ifdef FIREBEETLE_BATTERY
  long sumMv = 0;
  for (int i = 0; i < 8; i++) {
    sumMv += analogReadMilliVolts(kBatteryAdcPin);
    delay(2);
  }
  return (sumMv / 8.0f) * kBatteryDivider / 1000.0f;
#else
  return 0.0f;
#endif
}

static int batteryPercent(float voltage) {
#ifdef FIREBEETLE_BATTERY
  if (voltage >= kBatteryFullV) {
    return 100;
  }
  if (voltage <= kBatteryEmptyV) {
    return 0;
  }
  return (int)(((voltage - kBatteryEmptyV) / (kBatteryFullV - kBatteryEmptyV)) * 100.0f);
#else
  return 0;
#endif
}

static void printMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  Serial.printf("MAC: %02x:%02x:%02x:%02x:%02x:%02x\n", mac[0], mac[1], mac[2], mac[3],
                mac[4], mac[5]);
}

static bool isPlausibleReading(const SensorReadings& reading) {
  if (reading.temperatureC < -40.0f || reading.temperatureC > 85.0f) {
    return false;
  }
  if (reading.humidity < 0.0f || reading.humidity > 100.0f) {
    return false;
  }
  if (reading.pressureHpa < 300 || reading.pressureHpa > 1100) {
    return false;
  }
  if (reading.lightLux < 0.0f || reading.lightLux > 120000.0f) {
    return false;
  }
  // UV can read slightly negative indoors when signal is below calibration floor.
  if (reading.uvMwCm2 < -15.0f || reading.uvMwCm2 > 100.0f) {
    return false;
  }
  // Signature of failed I2C reads (0xFF register values).
  if (reading.temperatureC <= -44.9f && reading.humidity >= 99.9f && reading.pressureHpa >= 65500) {
    return false;
  }
  return true;
}

static String i2cScanJson() {
  String body = "{\"sda_pin\":";
  body += String(kSensorI2cSdaPin);
  body += ",\"scl_pin\":";
  body += String(kSensorI2cSclPin);
  body += ",\"expected_addresses\":[\"0x22\",\"0x59\"],\"addresses\":[";
  bool first = true;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      if (!first) {
        body += ",";
      }
      first = false;
      body += "\"0x";
      if (addr < 16) {
        body += "0";
      }
      body += String(addr, HEX);
      body += "\"";
    }
  }
  body += "]}";
  return body;
}

static void handleI2cScanRequest() {
  httpServer.send(200, "application/json", i2cScanJson());
}

static void ensureWire() {
  if (wireStarted) {
    return;
  }
  Wire.begin(kSensorI2cSdaPin, kSensorI2cSclPin);
  Wire.setClock(100000);
  wireStarted = true;
}

static void tryInitEnvironmentalSensor() {
  ensureWire();
  if (environment.begin() == 0) {
    Serial.println("Environmental sensor ready (I2C 0x22)");
    sensorReady = true;
    return;
  }
  Serial.println("Environmental sensor init failed — will retry");
}

static void tryInitVocSensor(unsigned long now) {
  if (vocReady || vocWarming) {
    return;
  }
  ensureWire();
  // begin(0) skips the blocking 10s warmup; we warm up in loop instead.
  if (airQuality.begin(0)) {
    vocWarming = true;
    vocWarmupUntilMs = now + kVocWarmupMs;
    Serial.println("SGP40 detected (I2C 0x59) — warming up in background");
    return;
  }
  Serial.println("SGP40 init failed — will retry");
}

static void tickVocWarmup(unsigned long now) {
  if (!vocWarming || vocReady) {
    return;
  }
  if (now >= vocWarmupUntilMs) {
    vocWarming = false;
    vocReady = true;
    Serial.println("SGP40 air quality sensor ready");
  }
}

static bool readEnvironmentalSensor(SensorReadings* out) {
  if (!out) {
    return false;
  }

  SensorReadings candidate;
  candidate.updatedAtMs = millis();
  candidate.vocReady = vocReady;

  if (sensorReady) {
    const float temperatureC = environment.getTemperature(TEMP_C);
    const float humidity = environment.getHumidity();
    const uint16_t pressureHpa = environment.getAtmospherePressure(HPA);
    const float lightLux = environment.getLuminousIntensity();
    const float uvMwCm2 = environment.getUltravioletIntensity();

    if (isnan(temperatureC) || isnan(humidity) || isnan(lightLux) || isnan(uvMwCm2)) {
      return false;
    }

    candidate.temperatureC = temperatureC;
    candidate.humidity = humidity;
    candidate.pressureHpa = pressureHpa;
    candidate.lightLux = lightLux;
    candidate.uvMwCm2 = uvMwCm2;
  }

  if (vocReady || vocWarming) {
    if (sensorReady) {
      airQuality.setRhT(candidate.humidity, candidate.temperatureC);
    }
    candidate.vocIndex = airQuality.getVoclndex();
    candidate.vocReady = vocReady;
  }

  if (!sensorReady && !vocReady && !vocWarming) {
    return false;
  }

  if (sensorReady && !isPlausibleReading(candidate)) {
    *out = candidate;
    out->valid = false;
    return false;
  }

  candidate.valid = sensorReady;
  *out = candidate;
  return sensorReady || vocReady || vocWarming;
}

static void logSensorReadings(const SensorReadings& readings) {
  Serial.printf(
      "Sensor: temp=%.1f C humidity=%.1f %% pressure=%u hPa light=%.1f lx uv=%.2f mW/cm2",
      readings.temperatureC, readings.humidity, readings.pressureHpa, readings.lightLux,
      readings.uvMwCm2);
  if (readings.vocReady || vocWarming) {
    Serial.printf(" voc_index=%u", readings.vocIndex);
  }
  Serial.println();
}

static String readingsJson(const SensorReadings& readings) {
  String body = "{\"device\":\"";
  body += DEVICE_LABEL;
  body += "\",\"hostname\":\"";
  body += DEVICE_HOSTNAME;
  body += "\",\"sensor_ready\":";
  body += sensorReady ? "true" : "false";
  body += ",\"voc_ready\":";
  body += vocReady ? "true" : "false";
  body += ",\"voc_warming\":";
  body += vocWarming ? "true" : "false";
  body += ",\"valid\":";
  body += readings.valid ? "true" : "false";

  if (!sensorReady && !vocReady && !vocWarming) {
    body += ",\"error\":\"no sensors detected on I2C (expected 0x22 and 0x59) — check wiring and I2C switch\"";
  } else if (!readings.valid && sensorReady) {
    body += ",\"error\":\"environmental readings failed plausibility check\"";
  }

  if (readings.valid || sensorReady || vocReady || vocWarming) {
    if (sensorReady || readings.valid) {
      body += ",\"temperature_c\":";
      body += String(readings.temperatureC, 1);
      body += ",\"humidity\":";
      body += String(readings.humidity, 1);
      body += ",\"pressure_hpa\":";
      body += String(readings.pressureHpa);
      body += ",\"light_lux\":";
      body += String(readings.lightLux, 1);
      body += ",\"uv_mw_cm2\":";
      body += String(readings.uvMwCm2, 2);
    }
    if (readings.vocReady || vocWarming) {
      body += ",\"voc_index\":";
      body += String(readings.vocIndex);
    }
    if (readings.updatedAtMs > 0) {
      body += ",\"age_ms\":";
      body += String(millis() - readings.updatedAtMs);
    }
  }

#ifdef FIREBEETLE_BATTERY
  const float voltage = readBatteryVoltage();
  body += ",\"battery_v\":";
  body += String(voltage, 2);
  body += ",\"battery_percent\":";
  body += String(batteryPercent(voltage));
#endif

  body += "}";
  return body;
}

static void handleReadingsRequest() {
  httpServer.send(200, "application/json", readingsJson(latestReadings));
}

#ifdef FIREBEETLE_BATTERY
static void handleBatteryRequest() {
  const float voltage = readBatteryVoltage();
  const int percent = batteryPercent(voltage);
  String body = "{\"device\":\"";
  body += DEVICE_LABEL;
  body += "\",\"hostname\":\"";
  body += DEVICE_HOSTNAME;
  body += "\",\"voltage_v\":";
  body += String(voltage, 2);
  body += ",\"percent\":";
  body += String(percent);
  body += "}";
  httpServer.send(200, "application/json", body);
}
#endif

static void setupHttpServer() {
  httpServer.on("/readings", handleReadingsRequest);
  httpServer.on("/identify", handleIdentifyRequest);
  httpServer.on("/i2c-scan", handleI2cScanRequest);
#ifdef FIREBEETLE_BATTERY
  httpServer.on("/battery", handleBatteryRequest);
#endif
  httpServer.begin();
  Serial.println("HTTP endpoints: /readings /identify /i2c-scan /battery");
}

static void setupOta() {
  ArduinoOTA.setHostname(DEVICE_HOSTNAME);

  if (strlen(OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(OTA_PASSWORD);
  }

  ArduinoOTA.onStart([]() { Serial.println("OTA update started"); });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA update finished"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("OTA progress: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA error[%u]: ", error);
    if (error == OTA_AUTH_ERROR) {
      Serial.println("Auth failed");
    } else if (error == OTA_BEGIN_ERROR) {
      Serial.println("Begin failed");
    } else if (error == OTA_CONNECT_ERROR) {
      Serial.println("Connect failed");
    } else if (error == OTA_RECEIVE_ERROR) {
      Serial.println("Receive failed");
    } else if (error == OTA_END_ERROR) {
      Serial.println("End failed");
    }
  });

  ArduinoOTA.begin();
}

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  delay(2000);
#else
  delay(1000);
#endif

  Serial.println();
  Serial.print("Device: ");
  Serial.println(DEVICE_LABEL);
  Serial.print("Hostname: ");
  Serial.println(DEVICE_HOSTNAME);
  printMacAddress();
  setupStatusLed();

  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 60) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Failed — check SSID, password, and 2.4 GHz network.");
    return;
  }

  Serial.println("Connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  Serial.print("RSSI: ");
  Serial.println(WiFi.RSSI());

  if (!MDNS.begin(DEVICE_HOSTNAME)) {
    Serial.println("mDNS start failed");
  } else {
    Serial.print("mDNS: ");
    Serial.print(DEVICE_HOSTNAME);
    Serial.println(".local");
  }

#ifdef FIREBEETLE_BATTERY
  analogSetPinAttenuation(kBatteryAdcPin, ADC_11db);
#endif

  setupHttpServer();
  setupOta();
  Serial.println("Ready for OTA — sensor init runs in background.");
}

void loop() {
  ArduinoOTA.handle();
  httpServer.handleClient();
  handleIdentifyLed();

  static unsigned long lastSensorMs = 0;
  static unsigned long lastRetryMs = 0;
  static bool firstInitAttempt = true;
  const unsigned long now = millis();

  tickVocWarmup(now);

  if (firstInitAttempt || ((!sensorReady || (!vocReady && !vocWarming)) && now - lastRetryMs >= 30000)) {
    if (!firstInitAttempt) {
      lastRetryMs = now;
      Serial.println("Retrying sensor init...");
    }
    firstInitAttempt = false;
    if (!sensorReady) {
      tryInitEnvironmentalSensor();
    }
    if (!vocReady && !vocWarming) {
      tryInitVocSensor(now);
    }
  }

  if (now - lastSensorMs >= kSensorReadIntervalMs) {
    lastSensorMs = now;
    SensorReadings sample;
    if (readEnvironmentalSensor(&sample)) {
      latestReadings = sample;
      logSensorReadings(latestReadings);
    } else if (sample.updatedAtMs > 0) {
      latestReadings = sample;
      if (sample.vocReady || sample.valid) {
        logSensorReadings(latestReadings);
      } else {
        Serial.println("Sensor read failed plausibility check");
      }
    } else {
      latestReadings.valid = false;
    }
  }

  static unsigned long lastStatusMs = 0;
  if (now - lastStatusMs >= kStatusLogIntervalMs) {
    lastStatusMs = now;
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("Still connected, IP: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("WiFi lost — reconnecting...");
      WiFi.reconnect();
    }
  }
}
