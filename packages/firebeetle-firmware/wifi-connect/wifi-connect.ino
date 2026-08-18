#include <WiFi.h>

#ifndef WIFI_SSID
#define WIFI_SSID "REPLACE_ME"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "REPLACE_ME"
#endif

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  delay(2000);
#else
  delay(1000);
#endif

  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 60) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println("Failed — check SSID, password, and 2.4 GHz network.");
  }
}

void loop() {
  delay(10000);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Still connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi lost — reconnecting...");
    WiFi.reconnect();
  }
}
