"""Arducam PCA9685 pan-tilt (B0283-style) over I2C."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

PCA9685_ADDRESS = 0x40
MODE1 = 0x00
PRESCALE = 0xFE
LED0_ON_L = 0x06
OSC_CLOCK = 25_000_000
SERVO_HZ = 50
PULSE_MIN_US = 500
PULSE_MAX_US = 2500


def _i2c_bus_number() -> int:
    try:
        return int(os.environ.get("I2C_BUS", "1"))
    except ValueError:
        return 1


def _channel(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return value if 0 <= value <= 15 else default


def clamp_angle(value: Any, default: int = 90) -> int:
    try:
        angle = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(180, angle))


def angles_from_configuration(configuration: str | dict[str, Any] | None) -> tuple[int, int]:
    parsed: dict[str, Any] = {}
    if isinstance(configuration, dict):
        parsed = configuration
    elif isinstance(configuration, str) and configuration.strip():
        import json

        try:
            loaded = json.loads(configuration)
        except json.JSONDecodeError:
            loaded = {}
        if isinstance(loaded, dict):
            parsed = loaded
    return clamp_angle(parsed.get("pan", 90)), clamp_angle(parsed.get("tilt", 90))


class PanTiltController:
    def __init__(self) -> None:
        self._bus: Any = None
        self._available = False
        self._init()

    def _init(self) -> None:
        bus_number = _i2c_bus_number()
        try:
            from smbus2 import SMBus
        except ImportError:
            logger.info("smbus2 not installed — pan/tilt disabled")
            return

        try:
            self._bus = SMBus(bus_number)
            self._write(MODE1, 0x10)  # sleep
            prescale = int(round(OSC_CLOCK / (4096 * SERVO_HZ)) - 1)
            self._write(PRESCALE, prescale)
            self._write(MODE1, 0x00)
            time.sleep(0.005)
            self._write(MODE1, 0xA1)  # auto-increment + restart
            self._available = True
            logger.info("PCA9685 pan/tilt ready on i2c-%s", bus_number)
        except Exception:
            logger.warning("I2C pan/tilt unavailable on i2c-%s", bus_number, exc_info=True)
            self._bus = None

    def _write(self, register: int, value: int) -> None:
        if self._bus is None:
            return
        self._bus.write_byte_data(PCA9685_ADDRESS, register, value)

    def available(self) -> bool:
        return self._available

    def set_angles(self, pan: int, tilt: int) -> None:
        if not self._available or self._bus is None:
            return
        self._set_channel(_channel("PAN_CHANNEL", 0), clamp_angle(pan))
        self._set_channel(_channel("TILT_CHANNEL", 1), clamp_angle(tilt))

    def _set_channel(self, channel: int, angle: int) -> None:
        pulse_us = PULSE_MIN_US + (PULSE_MAX_US - PULSE_MIN_US) * angle / 180
        ticks = int(pulse_us * 4096 * SERVO_HZ / 1_000_000)
        ticks = max(0, min(4095, ticks))
        base = LED0_ON_L + 4 * channel
        self._write(base, 0)
        self._write(base + 1, 0)
        self._write(base + 2, ticks & 0xFF)
        self._write(base + 3, ticks >> 8)
