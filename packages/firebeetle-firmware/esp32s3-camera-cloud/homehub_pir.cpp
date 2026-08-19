#include "homehub_pir.h"

#include <driver/gpio.h>
#include <esp_sleep.h>

void homehubPirBegin() {
  // GPIO44 is UART0 RX by default — release it for the Gravity PIR input.
  Serial.end();
  delay(10);
  gpio_reset_pin(static_cast<gpio_num_t>(kPirGpio));
  pinMode(kPirGpio, INPUT);
}

bool homehubPirRead() { return digitalRead(kPirGpio) == HIGH; }

void homehubPirWaitUntilLow(uint32_t timeoutMs) {
  const unsigned long deadline = millis() + timeoutMs;
  while (homehubPirRead() && static_cast<long>(millis() - deadline) < 0) {
    delay(50);
  }
}

bool homehubPirWakeupWasMotion() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_GPIO;
}

bool homehubPirWakeupWasTimer() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
}

void homehubPirLightSleep(uint32_t timerWakeSeconds) {
  // GPIO44 is not RTC-capable on ESP32-S3, so light sleep + GPIO wake is used
  // instead of deep sleep for PIR-triggered capture.
  gpio_wakeup_enable(static_cast<gpio_num_t>(kPirGpio), GPIO_INTR_HIGH_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  if (timerWakeSeconds > 0) {
    esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(timerWakeSeconds) * 1000000ULL);
  }
  esp_light_sleep_start();
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_GPIO);
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_TIMER);
  gpio_wakeup_disable(static_cast<gpio_num_t>(kPirGpio));
}

void homehubPirToJson(JsonDocument& document, bool motionActive, unsigned long lastMotionCaptureMs) {
  document["pirGpio"] = kPirGpio;
  document["motionActive"] = motionActive;
  document["lastMotionCaptureMs"] = lastMotionCaptureMs;
}
