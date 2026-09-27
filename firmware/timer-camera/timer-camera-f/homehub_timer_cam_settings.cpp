#include "homehub_timer_cam_settings.h"

#include <Preferences.h>
#include <cstring>

namespace {

constexpr uint32_t kDefaultReportingSeconds = 30;
constexpr uint32_t kMinReportingSeconds = 15;
constexpr uint32_t kMaxReportingSeconds = 3600;

Preferences prefs;

uint32_t clampReportingSeconds(uint32_t seconds) {
  if (seconds < kMinReportingSeconds) return kMinReportingSeconds;
  if (seconds > kMaxReportingSeconds) return kMaxReportingSeconds;
  return seconds;
}

int clampAdjust(int value) {
  if (value < -2) return -2;
  if (value > 2) return 2;
  return value;
}

int clampQuality(int value) {
  if (value < 4) return 4;
  if (value > 63) return 63;
  return value;
}

}  // namespace

String timerCamSettingsFrameSizeId(framesize_t frameSize) {
  switch (frameSize) {
    case FRAMESIZE_QQVGA:
      return "qqvga";
    case FRAMESIZE_QCIF:
      return "qcif";
    case FRAMESIZE_QVGA:
      return "qvga";
    case FRAMESIZE_CIF:
      return "cif";
    case FRAMESIZE_HVGA:
      return "hvga";
    case FRAMESIZE_VGA:
      return "vga";
    case FRAMESIZE_SVGA:
      return "svga";
    case FRAMESIZE_XGA:
      return "xga";
    case FRAMESIZE_HD:
      return "hd";
    case FRAMESIZE_SXGA:
      return "sxga";
    case FRAMESIZE_UXGA:
      return "uxga";
    default:
      return "qvga";
  }
}

framesize_t timerCamSettingsFrameSizeFromId(const char* value) {
  if (!value) return FRAMESIZE_QVGA;
  if (strcmp(value, "qqvga") == 0) return FRAMESIZE_QQVGA;
  if (strcmp(value, "qcif") == 0) return FRAMESIZE_QCIF;
  if (strcmp(value, "qvga") == 0) return FRAMESIZE_QVGA;
  if (strcmp(value, "cif") == 0) return FRAMESIZE_CIF;
  if (strcmp(value, "hvga") == 0) return FRAMESIZE_HVGA;
  if (strcmp(value, "vga") == 0) return FRAMESIZE_VGA;
  if (strcmp(value, "svga") == 0) return FRAMESIZE_SVGA;
  if (strcmp(value, "xga") == 0) return FRAMESIZE_XGA;
  if (strcmp(value, "hd") == 0) return FRAMESIZE_HD;
  if (strcmp(value, "sxga") == 0) return FRAMESIZE_SXGA;
  if (strcmp(value, "uxga") == 0) return FRAMESIZE_UXGA;
  return FRAMESIZE_QVGA;
}

void timerCamSettingsLoad(TimerCamSettings& settings) {
  prefs.begin("homehub", true);
  settings.reportingIntervalSeconds =
      clampReportingSeconds(prefs.getUInt("reportSec", kDefaultReportingSeconds));
  settings.frameSize = static_cast<framesize_t>(prefs.getUChar("frameSize", FRAMESIZE_QVGA));
  settings.jpegQuality = clampQuality(prefs.getChar("jpegQ", 12));
  settings.brightness = clampAdjust(prefs.getChar("bright", 1));
  settings.saturation = clampAdjust(prefs.getChar("sat", -2));
  settings.contrast = clampAdjust(prefs.getChar("contrast", 0));
  settings.vflip = prefs.getBool("vflip", true);
  settings.hmirror = prefs.getBool("hmirror", false);
  settings.motionEnabled = prefs.getBool("motionEn", true);
  settings.motionCooldownSeconds = prefs.getUInt("motionCd", 15);
  settings.captureMode = prefs.getString("captureMd", "both");
  settings.powerMode = "always-on";
  settings.maintenanceMode = prefs.getBool("maint", false);
  if (settings.captureMode != "interval" && settings.captureMode != "motion") {
    settings.captureMode = "both";
  }
  if (settings.motionCooldownSeconds < 5) settings.motionCooldownSeconds = 5;
  if (settings.motionCooldownSeconds > 300) settings.motionCooldownSeconds = 300;
  prefs.end();
}

void timerCamSettingsStore(const TimerCamSettings& settings) {
  prefs.begin("homehub", false);
  prefs.putUInt("reportSec", settings.reportingIntervalSeconds);
  prefs.putUChar("frameSize", static_cast<uint8_t>(settings.frameSize));
  prefs.putChar("jpegQ", static_cast<int8_t>(settings.jpegQuality));
  prefs.putChar("bright", static_cast<int8_t>(settings.brightness));
  prefs.putChar("sat", static_cast<int8_t>(settings.saturation));
  prefs.putChar("contrast", static_cast<int8_t>(settings.contrast));
  prefs.putBool("vflip", settings.vflip);
  prefs.putBool("hmirror", settings.hmirror);
  prefs.putBool("motionEn", settings.motionEnabled);
  prefs.putUInt("motionCd", settings.motionCooldownSeconds);
  prefs.putString("captureMd", settings.captureMode);
  prefs.putString("powerMd", "always-on");
  prefs.putBool("maint", settings.maintenanceMode);
  prefs.end();
}

bool timerCamSettingsApplyJson(JsonVariant desired, TimerCamSettings& settings) {
  if (desired.isNull()) {
    return false;
  }
  bool changed = false;
  if (desired["reportingIntervalSeconds"].is<uint32_t>()) {
    const uint32_t next =
        clampReportingSeconds(desired["reportingIntervalSeconds"].as<uint32_t>());
    if (settings.reportingIntervalSeconds != next) {
      settings.reportingIntervalSeconds = next;
      changed = true;
    }
  }
  if (desired["frameSize"].is<const char*>()) {
    const framesize_t next = timerCamSettingsFrameSizeFromId(desired["frameSize"].as<const char*>());
    if (settings.frameSize != next) {
      settings.frameSize = next;
      changed = true;
    }
  }
  if (desired["jpegQuality"].is<int>()) {
    const int next = clampQuality(desired["jpegQuality"].as<int>());
    if (settings.jpegQuality != next) {
      settings.jpegQuality = next;
      changed = true;
    }
  }
  if (desired["brightness"].is<int>()) {
    const int next = clampAdjust(desired["brightness"].as<int>());
    if (settings.brightness != next) {
      settings.brightness = next;
      changed = true;
    }
  }
  if (desired["saturation"].is<int>()) {
    const int next = clampAdjust(desired["saturation"].as<int>());
    if (settings.saturation != next) {
      settings.saturation = next;
      changed = true;
    }
  }
  if (desired["contrast"].is<int>()) {
    const int next = clampAdjust(desired["contrast"].as<int>());
    if (settings.contrast != next) {
      settings.contrast = next;
      changed = true;
    }
  }
  if (desired["vflip"].is<bool>()) {
    const bool next = desired["vflip"].as<bool>();
    if (settings.vflip != next) {
      settings.vflip = next;
      changed = true;
    }
  }
  if (desired["hmirror"].is<bool>()) {
    const bool next = desired["hmirror"].as<bool>();
    if (settings.hmirror != next) {
      settings.hmirror = next;
      changed = true;
    }
  }
  if (desired["motionEnabled"].is<bool>()) {
    const bool next = desired["motionEnabled"].as<bool>();
    if (settings.motionEnabled != next) {
      settings.motionEnabled = next;
      changed = true;
    }
  }
  if (desired["motionCooldownSeconds"].is<uint32_t>()) {
    uint32_t next = desired["motionCooldownSeconds"].as<uint32_t>();
    if (next < 5) next = 5;
    if (next > 300) next = 300;
    if (settings.motionCooldownSeconds != next) {
      settings.motionCooldownSeconds = next;
      changed = true;
    }
  }
  if (desired["captureMode"].is<const char*>()) {
    const char* raw = desired["captureMode"].as<const char*>();
    String next = "both";
    if (raw && (strcmp(raw, "interval") == 0 || strcmp(raw, "motion") == 0)) {
      next = raw;
    }
    if (settings.captureMode != next) {
      settings.captureMode = next;
      changed = true;
    }
  }
  if (desired["maintenanceMode"].is<bool>()) {
    const bool next = desired["maintenanceMode"].as<bool>();
    if (settings.maintenanceMode != next) {
      settings.maintenanceMode = next;
      changed = true;
    }
  }
  if (desired["captureNow"].is<const char*>()) {
    const char* raw = desired["captureNow"].as<const char*>();
    if (raw && *raw && settings.captureNow != raw) {
      settings.captureNow = raw;
      settings.captureNowPending = true;
    }
  }
  settings.powerMode = "always-on";
  return changed;
}

void timerCamSettingsToJson(const TimerCamSettings& settings, JsonDocument& document) {
  document["reportingIntervalSeconds"] = settings.reportingIntervalSeconds;
  document["frameSize"] = timerCamSettingsFrameSizeId(settings.frameSize);
  document["jpegQuality"] = settings.jpegQuality;
  document["brightness"] = settings.brightness;
  document["saturation"] = settings.saturation;
  document["contrast"] = settings.contrast;
  document["vflip"] = settings.vflip;
  document["hmirror"] = settings.hmirror;
  document["motionEnabled"] = settings.motionEnabled;
  document["motionCooldownSeconds"] = settings.motionCooldownSeconds;
  document["captureMode"] = settings.captureMode;
  document["powerMode"] = "always-on";
  document["maintenanceMode"] = settings.maintenanceMode;
  if (settings.captureNow.length() > 0 && !settings.captureNowPending) {
    document["captureNow"] = settings.captureNow;
  }
}

bool timerCamSettingsWantInterval(const TimerCamSettings& settings) {
  return settings.captureMode == "both" || settings.captureMode == "interval";
}

bool timerCamSettingsWantMotion(const TimerCamSettings& settings) {
  return settings.motionEnabled &&
         (settings.captureMode == "both" || settings.captureMode == "motion");
}
