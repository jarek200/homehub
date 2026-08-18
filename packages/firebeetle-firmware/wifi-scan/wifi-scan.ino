#include <WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("Scanning for WiFi networks (2.4 GHz)...");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  int count = WiFi.scanNetworks();
  if (count == 0) {
    Serial.println("No networks found.");
  } else {
    Serial.printf("Found %d network(s):\n", count);
    for (int i = 0; i < count; i++) {
      Serial.printf("  %2d  %-32s  %4d dBm  %s\n",
                    i + 1,
                    WiFi.SSID(i).c_str(),
                    WiFi.RSSI(i),
                    WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
    }
  }
  Serial.println("Done.");
}

void loop() {}
