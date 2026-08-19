#include "homehub_pir.h"

#include <driver/gpio.h>

void homehubPirBegin() {
  // GPIO44 is UART0 RX by default — release it for the Gravity PIR input.
  Serial.end();
  delay(10);
  gpio_reset_pin(static_cast<gpio_num_t>(kPirGpio));
  pinMode(kPirGpio, INPUT);
}

bool homehubPirRead() { return digitalRead(kPirGpio) == HIGH; }

void homehubPirToJson(JsonDocument& document, bool motionActive, unsigned long lastMotionCaptureMs) {
  document["pirGpio"] = kPirGpio;
  document["motionActive"] = motionActive;
  document["lastMotionCaptureMs"] = lastMotionCaptureMs;
}
