#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WiFi.h>

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

// FireBeetle ESP32-E: onboard 2:1 divider on GPIO34 (VBAT). Set via flash scripts.
#ifdef FIREBEETLE_BATTERY
#include <WebServer.h>

constexpr int kBatteryAdcPin = 34;
constexpr float kBatteryDivider = 2.0f;
constexpr float kBatteryFullV = 4.20f;
constexpr float kBatteryEmptyV = 3.30f;

WebServer batteryServer(80);

static float readBatteryVoltage() {
  long sumMv = 0;
  for (int i = 0; i < 8; i++) {
    sumMv += analogReadMilliVolts(kBatteryAdcPin);
    delay(2);
  }
  return (sumMv / 8.0f) * kBatteryDivider / 1000.0f;
}

static int batteryPercent(float voltage) {
  if (voltage >= kBatteryFullV) {
    return 100;
  }
  if (voltage <= kBatteryEmptyV) {
    return 0;
  }
  return (int)(((voltage - kBatteryEmptyV) / (kBatteryFullV - kBatteryEmptyV)) * 100.0f);
}

static void logBatteryReading() {
  const float voltage = readBatteryVoltage();
  Serial.printf("Battery: %.2f V (%d%%)\n", voltage, batteryPercent(voltage));
}

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
  batteryServer.send(200, "application/json", body);
}

static void setupBatteryMonitor() {
  analogSetPinAttenuation(kBatteryAdcPin, ADC_11db);
  batteryServer.on("/battery", handleBatteryRequest);
  batteryServer.begin();
  logBatteryReading();
  Serial.println("Battery endpoint: http://<ip>/battery");
}
#endif

static void printMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  Serial.printf("MAC: %02x:%02x:%02x:%02x:%02x:%02x\n", mac[0], mac[1], mac[2], mac[3],
                mac[4], mac[5]);
}

static void setupOta() {
  ArduinoOTA.setHostname(DEVICE_HOSTNAME);

  if (strlen(OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(OTA_PASSWORD);
  }

  ArduinoOTA.onStart([]() {
    Serial.println("OTA update started");
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\nOTA update finished");
  });
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

  setupOta();
#ifdef FIREBEETLE_BATTERY
  setupBatteryMonitor();
#endif
  Serial.println("Ready for OTA");
}

void loop() {
  ArduinoOTA.handle();
#ifdef FIREBEETLE_BATTERY
  batteryServer.handleClient();
#endif

  static unsigned long lastStatusMs = 0;
  const unsigned long now = millis();
  if (now - lastStatusMs >= 10000) {
    lastStatusMs = now;
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("Still connected, IP: ");
      Serial.println(WiFi.localIP());
#ifdef FIREBEETLE_BATTERY
      logBatteryReading();
#endif
    } else {
      Serial.println("WiFi lost — reconnecting...");
      WiFi.reconnect();
    }
  }
}
