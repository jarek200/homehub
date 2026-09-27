#!/usr/bin/env python3
"""USB console helper for the CoreS3 Matter controller.

Sends long lines slowly so the dataset is not truncated. Redacts setup
codes, Thread dataset TLVs, and Wi-Fi passwords from stdout.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

CHAR_DELAY_S = 0.003
DEFAULT_PORT = "/dev/cu.usbmodem101"
BAUD = 115200

_DATASET_HEX = re.compile(r"(?i)\b(?:0x)?([0-9a-f]{64,})\b")
_MANUAL_CODE = re.compile(r"\b\d{11}\b")
_QR_PAYLOAD = re.compile(r"\bMT:[A-Za-z0-9._-]+\b")


def _die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _load_serial():
    try:
        import serial  # type: ignore
    except ImportError:
        _die("pyserial missing. Use $HOME/.espressif/python_env/idf5.4_py3.12_env/bin/python")
    return serial


def _secret_files() -> list[Path]:
    repo = Path(__file__).resolve().parents[2]
    return [repo / ".env.local", Path.home() / ".zshrc.local"]


def _wifi_creds() -> tuple[str, str]:
    def grab(name: str) -> str:
        from_env = os.environ.get(name, "").strip()
        if from_env:
            return from_env
        pattern = re.compile(rf"^(?:export\s+)?{name}=(['\"]?)(.+?)\1\s*$", re.M)
        for path in _secret_files():
            if not path.is_file():
                continue
            match = pattern.search(path.read_text(encoding="utf-8"))
            if match:
                return match.group(2)
        _die(f"missing {name} in .env.local")
        return ""

    return grab("WIFI_SSID"), grab("WIFI_PASSWORD")


class Redactor:
    def __init__(self) -> None:
        self._extras: list[str] = []

    def remember(self, secret: str | None) -> None:
        if secret:
            self._extras.append(secret)

    def apply(self, text: str) -> str:
        out = text
        for secret in sorted(self._extras, key=len, reverse=True):
            if secret:
                out = out.replace(secret, "***")
        out = _QR_PAYLOAD.sub("***QR***", out)
        out = _DATASET_HEX.sub("***DATASET***", out)
        out = _MANUAL_CODE.sub("***CODE***", out)
        return out


class Console:
    def __init__(self, port: str, redactor: Redactor) -> None:
        serial = _load_serial()
        if not Path(port).exists():
            _die(f"no serial port {port}. Plug CoreS3 USB-C into this Mac.")
        self.port = port
        self.redactor = redactor
        # Opening with DTR/RTS high resets the ESP32-S3 and aborts pairing.
        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = BAUD
        self.ser.timeout = 0.2
        self.ser.dtr = False
        self.ser.rts = False
        self.ser.open()

    def close(self) -> None:
        self.ser.close()

    def drain(self, seconds: float = 0.4) -> str:
        end = time.time() + seconds
        buf = []
        while time.time() < end:
            chunk = self.ser.read(4096)
            if chunk:
                buf.append(chunk.decode("utf-8", "replace"))
        return "".join(buf)

    def send(self, command: str, wait: float) -> str:
        self.drain(0.2)
        for char in command:
            self.ser.write(char.encode())
            time.sleep(CHAR_DELAY_S)
        self.ser.write(b"\r")
        end = time.time() + wait
        buf = [self.drain(0.05)]
        while time.time() < end:
            chunk = self.ser.read(4096)
            if chunk:
                buf.append(chunk.decode("utf-8", "replace"))
        return "".join(buf)

    def send_logged(self, command: str, wait: float, display: str | None = None) -> str:
        shown = display if display is not None else command
        print(f">>> {self.redactor.apply(shown)}", flush=True)
        raw = self.send(command, wait)
        print(self.redactor.apply(raw), end="" if raw.endswith("\n") else "\n", flush=True)
        return raw


def _extract_dataset(raw: str) -> str:
    for line in raw.splitlines():
        stripped = line.strip()
        if re.fullmatch(r"[0-9A-Fa-f]{64,}", stripped):
            return stripped
    matches = _DATASET_HEX.findall(raw)
    if matches:
        return max(matches, key=len)
    _die("could not read Thread dataset from console (redacted). Is Thread up?")


def _thread_role(raw: str) -> str | None:
    for role in ("leader", "router", "child", "detached", "disabled", "offline"):
        if re.search(rf"\b{role}\b", raw, re.I):
            return role
    return None


def cmd_state(console: Console) -> None:
    raw = console.send_logged("matter esp ot_cli state", 4)
    role = _thread_role(raw)
    if role not in ("leader", "router"):
        _die(f"Thread role is {role or 'unknown'}; need leader or router before pairing.")
    print(f"thread_role={role}")


def cmd_wifi_connect(console: Console) -> None:
    ssid, password = _wifi_creds()
    console.redactor.remember(password)
    console.redactor.remember(ssid)
    raw = console.send(
        f"matter esp wifi connect {ssid} {password}",
        20,
    )
    print(console.redactor.apply(raw))


def cmd_send(console: Console, command: str, wait: float) -> None:
    console.send_logged(command, wait)


def _commission_quiet(console: Console, on: bool) -> None:
    verb = "on" if on else "off"
    raw = console.send_logged(f"matter esp homehub commission {verb}", 3)
    if "quiet" not in raw.lower() and "error" in raw.lower():
        print(f"commission quiet {verb}: command missing or failed (old image?)", flush=True)
    if on:
        time.sleep(2)


def cmd_pair(console: Console, node: int, payload: str, wait: float) -> None:
    console.redactor.remember(payload)
    state_raw = console.send_logged("matter esp ot_cli state", 4)
    role = _thread_role(state_raw)
    if role not in ("leader", "router"):
        _die(f"Thread role is {role or 'unknown'}; need leader or router before pairing.")
    dataset_raw = console.send("matter esp ot_cli dataset active -x", 6)
    dataset = _extract_dataset(dataset_raw)
    console.redactor.remember(dataset)
    print("dataset=ok (redacted)", flush=True)
    _commission_quiet(console, True)
    pair_cmd = f"matter esp controller pairing code-thread {node} {dataset} {payload}"
    raw = ""
    try:
        raw = console.send_logged(
            pair_cmd,
            wait,
            display=f"matter esp controller pairing code-thread {node} ***DATASET*** ***CODE***",
        )
    finally:
        try:
            _commission_quiet(console, False)
        except Exception:
            print("commission quiet off: skipped (console gone?)", flush=True)
    lowered = raw.lower()
    ok = (
        "commissioning success" in lowered
        or "commissioning complete" in lowered
        and "success" in lowered
    )
    if not ok:
        _die("pairing did not report success. See redacted log above.")
    print(f"paired_node={node}")


def _payload_from_args(args: argparse.Namespace) -> str:
    payload = (args.code or os.environ.get("SETUP_PAYLOAD") or "").strip()
    if not payload:
        _die("pass --code or set SETUP_PAYLOAD")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default=os.environ.get("CORES3_PORT", DEFAULT_PORT))
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("state", help="require Thread leader")
    sub.add_parser("wifi-connect", help="join Wi-Fi from .env.local")

    send = sub.add_parser("send", help="send one console command")
    send.add_argument("--cmd", required=True)
    send.add_argument("--wait", type=float, default=8)

    pair = sub.add_parser("pair", help="code-thread using the board dataset")
    pair.add_argument("--node", type=int, required=True)
    pair.add_argument("--code", default=None, help="11-digit or QR; prefer SETUP_PAYLOAD")
    pair.add_argument("--wait", type=float, default=180)

    args = parser.parse_args()
    redactor = Redactor()
    if args.action == "pair":
        redactor.remember(_payload_from_args(args))
    console = Console(args.port, redactor)
    try:
        if args.action == "state":
            cmd_state(console)
        elif args.action == "wifi-connect":
            cmd_wifi_connect(console)
        elif args.action == "send":
            cmd_send(console, args.cmd, args.wait)
        elif args.action == "pair":
            cmd_pair(console, args.node, _payload_from_args(args), args.wait)
    finally:
        console.close()


if __name__ == "__main__":
    main()
