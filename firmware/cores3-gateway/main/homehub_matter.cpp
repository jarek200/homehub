#include "homehub_matter.h"

#include "homehub_aws.h"

#include <esp_log.h>
#include <lib/core/CHIPError.h>
#include <esp_matter.h>
#include <esp_matter_console.h>
#include <esp_matter_controller_cluster_command.h>
#include <esp_matter_controller_pairing_command.h>
#include <esp_matter_controller_read_command.h>
#include <esp_matter_controller_subscribe_command.h>
#include <esp_openthread.h>
#include <esp_openthread_lock.h>
#include <openthread/dataset.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <lib/core/TLV.h>
#include <math.h>
#include <optional>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <utility>

static const char *TAG = "homehub_matter";

static constexpr uint32_t kOnOffCluster = 0x0006;
static constexpr uint32_t kLevelCluster = 0x0008;
static constexpr uint32_t kBooleanStateCluster = 0x0045;
static constexpr uint32_t kPowerSourceCluster = 0x002F;
static constexpr uint32_t kIlluminanceCluster = 0x0400;
static constexpr uint32_t kTemperatureCluster = 0x0402;
static constexpr uint32_t kHumidityCluster = 0x0405;
static constexpr uint32_t kOccupancyCluster = 0x0406;
static constexpr uint32_t kCo2Cluster = 0x040D;
static constexpr uint32_t kAirQualityCluster = 0x005B;
static constexpr uint32_t kPm25Cluster = 0x042A;
static constexpr uint32_t kMeasuredValueAttr = 0;
static constexpr uint32_t kOnOffAttr = 0;
static constexpr uint32_t kCurrentLevelAttr = 0;
static constexpr uint32_t kStateValueAttr = 0;
static constexpr uint32_t kOccupancyAttr = 0;
static constexpr uint32_t kBatteryPercentRemainingAttr = 0x000C;
static constexpr uint32_t kOnOffOff = 0;
static constexpr uint32_t kOnOffOn = 1;
static constexpr uint32_t kMoveToLevel = 0;
static constexpr uint32_t kMoveToLevelWithOnOff = 4;
static constexpr int kPollIntervalMs = 60000;
static constexpr int kQuietTimeoutUs = 180 * 1000 * 1000;
static constexpr int kReadTimeoutMs = 20000;
static constexpr int kMaxSubscriptionRetrySeconds = 30;
static const char kMoveToLevel40[] = "{\"0:U8\":102,\"1:U16\":0}";
static const char kMoveToLevelOn[] = "{\"0:U8\":254,\"1:U16\":0}";
static const char kMoveToLevelOff[] = "{\"0:U8\":0,\"1:U16\":0}";

struct NodeRead {
    uint64_t node_id;
    char device_id[20];
    char type[16];
    uint16_t endpoints[6];
    uint32_t clusters[6];
    uint32_t attributes[6];
    size_t count;
};

struct SubscriptionHealth {
    uint64_t node_id;
    int64_t last_report_us;
    int64_t retry_at_us;
    uint8_t retry_attempts;
    bool connecting;
    bool active;
};

static volatile uint32_t s_read_generation;
static volatile uint32_t s_read_done_generation;
static volatile uint64_t s_active_node_id;
static volatile bool s_accept_done;
static volatile bool s_read_got_data;
static volatile int s_alpstuga_attempts;
static volatile int s_alpstuga_completed;
static volatile int s_alpstuga_attributes;
static bool s_started;
static volatile bool s_quiet;
static bool s_subscribed;
static void *s_sub_cmd[HOMEHUB_FABRIC_MAX];
static uint64_t s_sub_node[HOMEHUB_FABRIC_MAX];
static SubscriptionHealth s_sub_health[HOMEHUB_FABRIC_MAX];
static portMUX_TYPE s_sub_lock = portMUX_INITIALIZER_UNLOCKED;
static esp_timer_handle_t s_quiet_timer;
static void apply_pending_light(void);
static void apply_pending_plug(void);
static void subscribe_live_nodes(void);
static void process_subscription_retries(void);
static TaskHandle_t s_task;
static uint32_t s_seen_fabric_generation;
static char s_pair_payload[256];
static uint64_t s_pair_node;
static volatile bool s_pairing;
static char s_pair_result_event[24];
static char s_pair_result_error[48];
static uint64_t s_pair_result_node;
static volatile bool s_pair_result_ready;
static portMUX_TYPE s_cmd_lock = portMUX_INITIALIZER_UNLOCKED;
static int s_pending_on = -1;
static int s_pending_bri = -1;
static uint64_t s_pending_light_node;
static int s_pending_plug = -1;
static uint64_t s_pending_plug_node;
static int s_last_bri = 100;
static char s_level_json[40];

static bool copy_fabric_node(int index, NodeRead *out)
{
    HomehubFabricNode node = {};
    if (out == nullptr || homehub_aws_copy_fabric_node(index, &node) != 0) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    out->node_id = node.node_id;
    strncpy(out->device_id, node.device_id, sizeof(out->device_id) - 1);
    strncpy(out->type, node.type, sizeof(out->type) - 1);
    out->count = node.count > 6 ? 6 : node.count;
    for (size_t i = 0; i < out->count; ++i) {
        out->endpoints[i] = node.endpoints[i];
        out->clusters[i] = node.clusters[i];
        out->attributes[i] = node.attributes[i];
    }
    return true;
}

static const char *device_id_for_node(uint64_t node_id)
{
    return homehub_aws_device_id_for_node(node_id);
}

static bool urgent_device_type(const char *type)
{
    return type != nullptr &&
           (strcmp(type, "light") == 0 || strcmp(type, "plug") == 0 || strcmp(type, "contact") == 0 ||
            strcmp(type, "motion") == 0 || strcmp(type, "leak") == 0);
}

static void mark_device_reachable(const char *device_id)
{
    if (device_id == nullptr) {
        return;
    }
    int changed = homehub_aws_mark_seen(device_id);
    const char *type = homehub_aws_device_type(device_id);
    if (type != nullptr && (strcmp(type, "light") == 0 || strcmp(type, "plug") == 0)) {
        changed = homehub_aws_set_reachable(device_id, 1) || changed;
    }
    if (changed) {
        homehub_aws_notify_state_changed();
        if (urgent_device_type(type)) {
            homehub_aws_publish_state_soon();
        }
    }
}

static bool actuator_type(const char *type)
{
    return type != nullptr && (strcmp(type, "light") == 0 || strcmp(type, "plug") == 0);
}

static void mark_device_stale(const char *device_id)
{
    if (device_id == nullptr) {
        return;
    }
    int changed = homehub_aws_mark_stale(device_id);
    const char *type = homehub_aws_device_type(device_id);
    if (actuator_type(type)) {
        changed = homehub_aws_set_reachable(device_id, 0) || changed;
    }
    if (changed) {
        homehub_aws_notify_state_changed();
        if (urgent_device_type(type)) {
            homehub_aws_publish_state_soon();
        }
    }
}

static bool subscription_is_active(uint64_t node_id)
{
    bool active = false;
    portENTER_CRITICAL(&s_sub_lock);
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_health[i].node_id == node_id) {
            active = s_sub_health[i].active;
            break;
        }
    }
    portEXIT_CRITICAL(&s_sub_lock);
    return active;
}

static void expire_device_freshness()
{
    if (homehub_aws_expire_reachable()) {
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
    }
}

static SubscriptionHealth *subscription_health_locked(uint64_t node_id)
{
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_health[i].node_id == node_id) {
            return &s_sub_health[i];
        }
    }
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_health[i].node_id == 0) {
            s_sub_health[i].node_id = node_id;
            return &s_sub_health[i];
        }
    }
    return nullptr;
}

static bool begin_subscription_attempt(uint64_t node_id)
{
    bool begin = false;
    portENTER_CRITICAL(&s_sub_lock);
    SubscriptionHealth *health = subscription_health_locked(node_id);
    if (health != nullptr && !health->active && !health->connecting) {
        health->connecting = true;
        health->retry_at_us = 0;
        begin = true;
    }
    portEXIT_CRITICAL(&s_sub_lock);
    return begin;
}

static void mark_subscription_report(uint64_t node_id)
{
    portENTER_CRITICAL(&s_sub_lock);
    SubscriptionHealth *health = subscription_health_locked(node_id);
    if (health != nullptr) {
        health->active = true;
        health->connecting = false;
        health->retry_attempts = 0;
        health->retry_at_us = 0;
        health->last_report_us = esp_timer_get_time();
    }
    portEXIT_CRITICAL(&s_sub_lock);
    mark_device_reachable(device_id_for_node(node_id));
}

static void schedule_subscription_retry(uint64_t node_id, const char *reason)
{
    if (node_id == 0) {
        return;
    }
    int retry_seconds = 1;
    portENTER_CRITICAL(&s_sub_lock);
    SubscriptionHealth *health = subscription_health_locked(node_id);
    if (health != nullptr) {
        const uint8_t shift = health->retry_attempts < 5 ? health->retry_attempts : 5;
        retry_seconds = 1 << shift;
        if (retry_seconds > kMaxSubscriptionRetrySeconds) {
            retry_seconds = kMaxSubscriptionRetrySeconds;
        }
        if (health->retry_attempts < UINT8_MAX) {
            ++health->retry_attempts;
        }
        health->active = false;
        health->connecting = false;
        health->retry_at_us = esp_timer_get_time() + static_cast<int64_t>(retry_seconds) * 1000000;
    }
    portEXIT_CRITICAL(&s_sub_lock);
    ESP_LOGW(TAG, "Subscription node %llu %s; retry in %ds",
             static_cast<unsigned long long>(node_id), reason, retry_seconds);
    if (!s_quiet) {
        mark_device_stale(device_id_for_node(node_id));
    }
    if (s_task != nullptr) {
        xTaskNotifyGive(s_task);
    }
}

static void reset_subscription_health()
{
    portENTER_CRITICAL(&s_sub_lock);
    memset(s_sub_cmd, 0, sizeof(s_sub_cmd));
    memset(s_sub_node, 0, sizeof(s_sub_node));
    memset(s_sub_health, 0, sizeof(s_sub_health));
    portEXIT_CRITICAL(&s_sub_lock);
}

static void track_subscribe(void *cmd, uint64_t node_id)
{
    portENTER_CRITICAL(&s_sub_lock);
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_cmd[i] == nullptr) {
            s_sub_cmd[i] = cmd;
            s_sub_node[i] = node_id;
            break;
        }
    }
    portEXIT_CRITICAL(&s_sub_lock);
}

static uint64_t untrack_subscribe(void *cmd)
{
    uint64_t node_id = 0;
    portENTER_CRITICAL(&s_sub_lock);
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_cmd[i] == cmd) {
            s_sub_cmd[i] = nullptr;
            node_id = s_sub_node[i];
            s_sub_node[i] = 0;
            break;
        }
    }
    portEXIT_CRITICAL(&s_sub_lock);
    return node_id;
}

static void untrack_subscribe_node(uint64_t node_id)
{
    portENTER_CRITICAL(&s_sub_lock);
    for (int i = 0; i < HOMEHUB_FABRIC_MAX; ++i) {
        if (s_sub_cmd[i] != nullptr && s_sub_node[i] == node_id) {
            s_sub_cmd[i] = nullptr;
            s_sub_node[i] = 0;
        }
    }
    portEXIT_CRITICAL(&s_sub_lock);
}

static void on_subscribe_done(uint64_t node_id, uint32_t subscription_id)
{
    (void)subscription_id;
    untrack_subscribe_node(node_id);
    schedule_subscription_retry(node_id, "ended");
}

static void on_subscribe_fail(void *subscribe_command)
{
    const uint64_t node_id = untrack_subscribe(subscribe_command);
    schedule_subscription_retry(node_id, "connect failed");
}

static void apply_cluster_value(uint64_t node_id, uint32_t cluster_id, double number, bool flag, bool is_bool)
{
    const char *device_id = device_id_for_node(node_id);
    if (device_id == nullptr) {
        return;
    }
    mark_device_reachable(device_id);
    if (cluster_id == kOnOffCluster) {
        const char *type = homehub_aws_device_type(device_id);
        if (type != nullptr && strcmp(type, "plug") == 0) {
            homehub_aws_set_plug(device_id, flag ? 1 : 0);
        } else {
            homehub_aws_set_light(device_id, flag ? 1 : 0, -1);
        }
        homehub_aws_set_metric_bool(device_id, "on", flag ? 1 : 0);
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
        return;
    }
    if (cluster_id == kLevelCluster) {
        const int brightness = static_cast<int>(lround((number * 100.0) / 254.0));
        homehub_aws_set_light(device_id, -1, brightness);
        homehub_aws_set_metric(device_id, "brightness", brightness);
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
        return;
    }
    if (cluster_id == kTemperatureCluster) {
        homehub_aws_set_metric(device_id, "temperature", number);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kHumidityCluster) {
        homehub_aws_set_metric(device_id, "humidity", number);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kCo2Cluster) {
        homehub_aws_set_metric(device_id, "co2", number);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kPm25Cluster) {
        if (!isfinite(number) || number < 0) {
            return;
        }
        homehub_aws_set_metric(device_id, "pm25", lround(number * 10.0) / 10.0);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kAirQualityCluster) {
        homehub_aws_set_metric(device_id, "airQuality", number);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kIlluminanceCluster) {
        homehub_aws_set_metric(device_id, "lightLux", lround(number * 10.0) / 10.0);
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kPowerSourceCluster) {
        homehub_aws_set_metric(device_id, "batteryPercent", fmax(0.0, fmin(100.0, number)));
        homehub_aws_notify_state_changed();
        return;
    }
    if (cluster_id == kOccupancyCluster) {
        homehub_aws_set_motion(flag ? 1 : 0);
        homehub_aws_set_metric_bool(device_id, "occupied", flag ? 1 : 0);
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
        return;
    }
    if (cluster_id == kBooleanStateCluster) {
        const char *type = homehub_aws_device_type(device_id);
        if (type != nullptr && strcmp(type, "leak") == 0) {
            homehub_aws_set_leak(flag ? 1 : 0);
            homehub_aws_set_metric_bool(device_id, "leak", flag ? 1 : 0);
        } else {
            homehub_aws_set_contact(flag ? 1 : 0);
            homehub_aws_set_metric_bool(device_id, "open", flag ? 1 : 0);
        }
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
        return;
    }
    if (strcmp(device_id, "matter-6") == 0) {
        (void)homehub_aws_publish_state(nullptr);
    }
}

static void on_attribute(uint64_t node_id, const chip::app::ConcreteDataAttributePath &path,
                         chip::TLV::TLVReader *data)
{
    if (data == nullptr) {
        return;
    }
    if (node_id == s_active_node_id) {
        s_read_got_data = true;
    }
    mark_subscription_report(node_id);
    const uint32_t cluster_id = path.mClusterId;
    if (node_id == 7) {
        ++s_alpstuga_attributes;
        homehub_aws_set_alpstuga_diagnostics(s_alpstuga_attempts, s_alpstuga_completed, s_alpstuga_attributes);
    }
    const chip::TLV::TLVType type = data->GetType();
    if (type == chip::TLV::kTLVType_Boolean) {
        bool flag = false;
        if (data->Get(flag) == CHIP_NO_ERROR) {
            apply_cluster_value(node_id, cluster_id, 0, flag, true);
        }
        return;
    }
    if (type == chip::TLV::kTLVType_UnsignedInteger) {
        uint32_t raw = 0;
        if (data->Get(raw) != CHIP_NO_ERROR) {
            return;
        }
        if (cluster_id == kHumidityCluster) {
            if (raw == 0xFFFF) {
                return;
            }
            apply_cluster_value(node_id, cluster_id, raw / 100.0, false, false);
            return;
        }
        if (cluster_id == kIlluminanceCluster) {
            if (raw == 0xFFFF) {
                return;
            }
            const double lux =
                raw == 0 ? 0.0 : pow(10.0, (static_cast<double>(raw) - 1.0) / 10000.0);
            apply_cluster_value(node_id, cluster_id, lux, false, false);
            return;
        }
        if (cluster_id == kPowerSourceCluster && path.mAttributeId == kBatteryPercentRemainingAttr) {
            if (raw <= 200) {
                apply_cluster_value(node_id, cluster_id, raw / 2.0, false, false);
            }
            return;
        }
        if (cluster_id == kOccupancyCluster) {
            apply_cluster_value(node_id, cluster_id, 0, (raw & 0x1U) != 0, true);
            return;
        }
        if (cluster_id == kLevelCluster) {
            apply_cluster_value(node_id, cluster_id, raw, false, false);
            return;
        }
        if (cluster_id == kBooleanStateCluster) {
            apply_cluster_value(node_id, cluster_id, 0, raw != 0, true);
            return;
        }
        if (cluster_id == kPm25Cluster && raw == 0xFFFFFFFFU) {
            return;
        }
        if (cluster_id == kAirQualityCluster && raw > 6) {
            return;
        }
        apply_cluster_value(node_id, cluster_id, raw, false, false);
        return;
    }
    if (type == chip::TLV::kTLVType_SignedInteger) {
        int32_t raw = 0;
        if (data->Get(raw) != CHIP_NO_ERROR || raw == static_cast<int32_t>(0x8000)) {
            return;
        }
        if (cluster_id == kTemperatureCluster) {
            apply_cluster_value(node_id, cluster_id, raw / 100.0, false, false);
            return;
        }
        apply_cluster_value(node_id, cluster_id, raw, false, false);
        return;
    }
    if (type == chip::TLV::kTLVType_FloatingPointNumber) {
        float raw = 0;
        if (data->Get(raw) == CHIP_NO_ERROR) {
            apply_cluster_value(node_id, cluster_id, raw, false, false);
        }
    }
}

static void on_read_done(uint64_t node_id, const chip::Platform::ScopedMemoryBufferWithSize<chip::app::AttributePathParams> &,
                         const chip::Platform::ScopedMemoryBufferWithSize<chip::app::EventPathParams> &)
{
    ESP_LOGI(TAG, "Read done node %llu", static_cast<unsigned long long>(node_id));
    if (node_id == 7) {
        ++s_alpstuga_completed;
        homehub_aws_set_alpstuga_diagnostics(s_alpstuga_attempts, s_alpstuga_completed, s_alpstuga_attributes);
    }
    if (s_accept_done && node_id == s_active_node_id) {
        s_accept_done = false;
        s_read_done_generation = s_read_generation;
    }
}

static bool read_node_once(const NodeRead &node)
{
    if (node.node_id == 7) {
        ++s_alpstuga_attempts;
        homehub_aws_set_alpstuga_diagnostics(s_alpstuga_attempts, s_alpstuga_completed, s_alpstuga_attributes);
    }
    chip::Platform::ScopedMemoryBufferWithSize<chip::app::AttributePathParams> attr_paths;
    chip::Platform::ScopedMemoryBufferWithSize<chip::app::EventPathParams> event_paths;
    attr_paths.Alloc(node.count);
    if (!attr_paths.Get()) {
        ESP_LOGW(TAG, "No memory for node %llu reads", static_cast<unsigned long long>(node.node_id));
        return false;
    }
    for (size_t i = 0; i < node.count; ++i) {
        attr_paths[i] = chip::app::AttributePathParams(node.endpoints[i], node.clusters[i], node.attributes[i]);
    }

    s_active_node_id = node.node_id;
    s_accept_done = true;
    s_read_got_data = false;
    const uint32_t generation = s_read_generation + 1U;
    s_read_generation = generation;
    auto *cmd = chip::Platform::New<esp_matter::controller::read_command>(
        node.node_id, std::move(attr_paths), std::move(event_paths), on_attribute, on_read_done, nullptr);
    if (cmd == nullptr) {
        s_active_node_id = 0;
        ESP_LOGW(TAG, "Failed to alloc read for node %llu", static_cast<unsigned long long>(node.node_id));
        return false;
    }
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    const esp_err_t err = cmd->send_command();
    esp_matter::lock::chip_stack_unlock();
    if (err != ESP_OK) {
        s_active_node_id = 0;
        ESP_LOGW(TAG, "Read node %llu failed: %s", static_cast<unsigned long long>(node.node_id),
                 esp_err_to_name(err));
        return false;
    }
    const TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(kReadTimeoutMs);
    while (s_read_done_generation != generation && xTaskGetTickCount() < deadline) {
        apply_pending_light();
        apply_pending_plug();
        expire_device_freshness();
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    const bool done = s_read_done_generation == generation;
    const bool got_data = s_read_got_data;
    s_active_node_id = 0;
    if (!done) {
        ESP_LOGW(TAG, "Read timeout node %llu cluster 0x%lx", static_cast<unsigned long long>(node.node_id),
                 static_cast<unsigned long>(node.clusters[0]));
    } else if (!got_data) {
        ESP_LOGW(TAG, "Read empty node %llu", static_cast<unsigned long long>(node.node_id));
    }
    return done && got_data;
}

static bool read_node(const NodeRead &node)
{
    if (read_node_once(node)) {
        return true;
    }
    ESP_LOGW(TAG, "Retry node %llu", static_cast<unsigned long long>(node.node_id));
    const TickType_t retry_deadline = xTaskGetTickCount() + pdMS_TO_TICKS(750);
    while (xTaskGetTickCount() < retry_deadline) {
        apply_pending_light();
        apply_pending_plug();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    const bool done = read_node_once(node);
    if (!done && (actuator_type(node.type) || !subscription_is_active(node.node_id))) {
        mark_device_stale(node.device_id);
    }
    return done;
}

static void invoke_node_locked(uint64_t node_id, uint16_t endpoint, uint32_t cluster, uint32_t command,
                              const char *payload)
{
    const esp_err_t err =
        esp_matter::controller::send_invoke_cluster_command(node_id, endpoint, cluster, command, payload);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Invoke node %llu cluster 0x%lx cmd %lu failed: %s",
                 static_cast<unsigned long long>(node_id), static_cast<unsigned long>(cluster),
                 static_cast<unsigned long>(command), esp_err_to_name(err));
    }
}

static uint8_t level_from_percent(int percent)
{
    if (percent <= 0) {
        return 0;
    }
    if (percent >= 100) {
        return 254;
    }
    return static_cast<uint8_t>((percent * 254 + 50) / 100);
}

static void apply_pending_light(void)
{
    portENTER_CRITICAL(&s_cmd_lock);
    const int on = s_pending_on;
    const int bri = s_pending_bri;
    const uint64_t target = s_pending_light_node;
    s_pending_on = -1;
    s_pending_bri = -1;
    s_pending_light_node = 0;
    portEXIT_CRITICAL(&s_cmd_lock);
    if (on < 0 && bri < 0) {
        return;
    }

    const int percent = bri >= 0 ? bri : s_last_bri;
    const int turn_on = on >= 0 ? on : (percent > 0 ? 1 : 0);
    if (percent > 0) {
        s_last_bri = percent;
    }
    snprintf(s_level_json, sizeof(s_level_json), "{\"0:U8\":%u,\"1:U16\":0}",
             static_cast<unsigned>(level_from_percent(turn_on ? percent : 0)));
    ESP_LOGI(TAG, "Lights on=%d brightness=%d node=%llu", turn_on, turn_on ? percent : 0,
             static_cast<unsigned long long>(target));
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    const int count = homehub_aws_fabric_count();
    for (int i = 0; i < count; ++i) {
        NodeRead node = {};
        if (!copy_fabric_node(i, &node) || strcmp(node.type, "light") != 0) {
            continue;
        }
        if (target != 0 && node.node_id != target) {
            continue;
        }
        uint16_t endpoint = 1;
        for (size_t r = 0; r < node.count; ++r) {
            if (node.clusters[r] == kOnOffCluster) {
                endpoint = node.endpoints[r];
                break;
            }
        }
        invoke_node_locked(node.node_id, endpoint, kOnOffCluster, turn_on ? kOnOffOn : kOnOffOff, nullptr);
        invoke_node_locked(node.node_id, endpoint, kLevelCluster, kMoveToLevelWithOnOff, s_level_json);
    }
    esp_matter::lock::chip_stack_unlock();
}

static void request_light(int on, int brightness, bool update_state, const char *device_id)
{
    int bri = brightness;
    if (bri > 100) {
        bri = 100;
    }
    const bool scoped = device_id != nullptr && device_id[0] != '\0';
    const uint64_t node = homehub_aws_node_id_for_device(device_id);
    if (scoped && node == 0) {
        ESP_LOGW(TAG, "No fabric node for light %s", device_id);
        if (update_state) {
            if (on == 0) {
                homehub_aws_set_light(device_id, 0, bri >= 0 ? bri : 0);
            } else if (on == 1) {
                homehub_aws_set_light(device_id, 1, bri >= 0 ? bri : s_last_bri);
            } else if (bri >= 0) {
                homehub_aws_set_light(device_id, bri > 0 ? 1 : 0, bri);
            }
            homehub_aws_notify_state_changed();
            homehub_aws_publish_state_soon();
        }
        return;
    }
    if (update_state) {
        const char *id = device_id != nullptr && device_id[0] != '\0' ? device_id : nullptr;
        if (on == 0) {
            homehub_aws_set_light(id, 0, bri >= 0 ? bri : 0);
        } else if (on == 1) {
            homehub_aws_set_light(id, 1, bri >= 0 ? bri : s_last_bri);
        } else if (bri >= 0) {
            homehub_aws_set_light(id, bri > 0 ? 1 : 0, bri);
        }
        homehub_aws_notify_state_changed();
        homehub_aws_publish_state_soon();
    }
    portENTER_CRITICAL(&s_cmd_lock);
    s_pending_light_node = node;
    if (on == 0 || on == 1) {
        s_pending_on = on;
    }
    if (bri >= 0) {
        s_pending_bri = bri;
        if (bri == 0) {
            s_pending_on = 0;
        } else if (s_pending_on < 0) {
            s_pending_on = 1;
        }
    }
    portEXIT_CRITICAL(&s_cmd_lock);
    if (s_task != nullptr) {
        xTaskNotifyGive(s_task);
    }
}

static void invoke_plug_locked(uint64_t node, int on)
{
    ESP_LOGI(TAG, "Plug node %llu on=%d", static_cast<unsigned long long>(node), on);
    invoke_node_locked(node, 1, kOnOffCluster, on ? kOnOffOn : kOnOffOff, nullptr);
}

static void apply_pending_plug(void)
{
    portENTER_CRITICAL(&s_cmd_lock);
    const int on = s_pending_plug;
    const uint64_t node = s_pending_plug_node;
    s_pending_plug = -1;
    portEXIT_CRITICAL(&s_cmd_lock);
    if (on < 0) {
        return;
    }
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    if (node == 0) {
        HomehubFabricNode fabric;
        int invoked = 0;
        const int count = homehub_aws_fabric_count();
        for (int i = 0; i < count; ++i) {
            if (homehub_aws_copy_fabric_node(i, &fabric) != 0) {
                continue;
            }
            if (strcmp(fabric.type, "plug") != 0) {
                continue;
            }
            invoke_plug_locked(fabric.node_id, on);
            invoked++;
        }
        if (invoked == 0) {
            invoke_plug_locked(10, on);
            invoke_plug_locked(11, on);
        }
    } else {
        invoke_plug_locked(node, on);
    }
    esp_matter::lock::chip_stack_unlock();
}

static const char *plug_id_for_node(uint64_t node)
{
    const char *device_id = homehub_aws_device_id_for_node(node);
    return device_id != nullptr ? device_id : "matter-9";
}

static void request_plug(uint64_t node, int on)
{
    if (node == 0) {
        homehub_aws_set_plug(nullptr, on);
    } else {
        homehub_aws_set_plug(plug_id_for_node(node), on);
    }
    homehub_aws_notify_state_changed();
    homehub_aws_publish_state_soon();
    portENTER_CRITICAL(&s_cmd_lock);
    s_pending_plug = on;
    s_pending_plug_node = node;
    portEXIT_CRITICAL(&s_cmd_lock);
    if (s_task != nullptr) {
        xTaskNotifyGive(s_task);
    }
}

static void wait_servicing_commands(int ms)
{
    const TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(ms);
    while (xTaskGetTickCount() < deadline) {
        apply_pending_light();
        apply_pending_plug();
        process_subscription_retries();
        expire_device_freshness();
        TickType_t left = deadline - xTaskGetTickCount();
        if (left == 0) {
            break;
        }
        TickType_t slice = pdMS_TO_TICKS(100);
        if (slice > left) {
            slice = left;
        }
        (void)ulTaskNotifyTake(pdTRUE, slice);
    }
    apply_pending_light();
    apply_pending_plug();
}

void homehub_matter_apply_command(const char *command)
{
    if (command == nullptr) {
        return;
    }
    if (strcmp(command, "plug-on") == 0 || strcmp(command, "plug-on-10") == 0) {
        request_plug(10, 1);
        return;
    }
    if (strcmp(command, "plug-off") == 0 || strcmp(command, "plug-off-10") == 0) {
        request_plug(10, 0);
        return;
    }
    if (strcmp(command, "plug-on-11") == 0) {
        request_plug(11, 1);
        return;
    }
    if (strcmp(command, "plug-off-11") == 0) {
        request_plug(11, 0);
        return;
    }
    if (strcmp(command, "all-plugs-off") == 0) {
        request_plug(0, 0);
        return;
    }
    if (strcmp(command, "all-lights-off") == 0 || strcmp(command, "light-off") == 0) {
        request_light(0, 0, true, nullptr);
        return;
    }
    if (strncmp(command, "light-off-", 10) == 0) {
        request_light(0, 0, true, command + 10);
        return;
    }
    if (strcmp(command, "light-on") == 0) {
        request_light(1, s_last_bri, true, nullptr);
        return;
    }
    if (strncmp(command, "light-on-", 9) == 0) {
        request_light(1, s_last_bri, true, command + 9);
        return;
    }
    if (strncmp(command, "light-bri-", 10) == 0) {
        const char *rest = command + 10;
        const char *dash = strrchr(rest, '-');
        if (dash != nullptr && dash != rest && (rest[0] < '0' || rest[0] > '9')) {
            char device_id[20] = {};
            const size_t length = static_cast<size_t>(dash - rest);
            const size_t copy = length < sizeof(device_id) - 1 ? length : sizeof(device_id) - 1;
            memcpy(device_id, rest, copy);
            request_light(-1, atoi(dash + 1), true, device_id);
            return;
        }
        request_light(-1, atoi(rest), true, nullptr);
        return;
    }
    if (strcmp(command, "evening") == 0) {
        request_light(1, 40, true, nullptr);
    }
}


static void subscribe_node(const NodeRead &node, uint16_t min_interval, uint16_t max_interval)
{
    if (s_quiet || !begin_subscription_attempt(node.node_id)) {
        return;
    }
    chip::Platform::ScopedMemoryBufferWithSize<chip::app::AttributePathParams> attr_paths;
    chip::Platform::ScopedMemoryBufferWithSize<chip::app::EventPathParams> event_paths;
    attr_paths.Alloc(node.count);
    if (!attr_paths.Get()) {
        ESP_LOGW(TAG, "No memory to subscribe node %llu", static_cast<unsigned long long>(node.node_id));
        schedule_subscription_retry(node.node_id, "allocation failed");
        return;
    }
    for (size_t i = 0; i < node.count; ++i) {
        attr_paths[i] = chip::app::AttributePathParams(node.endpoints[i], node.clusters[i], node.attributes[i]);
    }
    auto *cmd = chip::Platform::New<esp_matter::controller::subscribe_command>(
        node.node_id, std::move(attr_paths), std::move(event_paths), min_interval, max_interval, true, on_attribute,
        nullptr, on_subscribe_done, on_subscribe_fail);
    if (cmd == nullptr) {
        ESP_LOGW(TAG, "Failed to alloc subscription for node %llu", static_cast<unsigned long long>(node.node_id));
        schedule_subscription_retry(node.node_id, "allocation failed");
        return;
    }
    track_subscribe(cmd, node.node_id);
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    const esp_err_t err = cmd->send_command();
    esp_matter::lock::chip_stack_unlock();
    if (err != ESP_OK) {
        untrack_subscribe(cmd);
        ESP_LOGW(TAG, "Subscribe node %llu send failed: %s", static_cast<unsigned long long>(node.node_id),
                 esp_err_to_name(err));
        schedule_subscription_retry(node.node_id, "send failed");
    } else {
        ESP_LOGI(TAG, "Subscription requested for node %llu", static_cast<unsigned long long>(node.node_id));
    }
}

static bool should_subscribe(const NodeRead &node)
{
    if (strcmp(node.type, "light") == 0 || strcmp(node.type, "plug") == 0 ||
        strcmp(node.type, "motion") == 0 || strcmp(node.type, "contact") == 0 ||
        strcmp(node.type, "leak") == 0) {
        return true;
    }
    for (size_t i = 0; i < node.count; ++i) {
        if (node.clusters[i] == kCo2Cluster) {
            return true;
        }
    }
    return false;
}

static void subscribe_live_nodes(void)
{
    const int count = homehub_aws_fabric_count();
    for (int i = 0; i < count; ++i) {
        NodeRead node = {};
        if (!copy_fabric_node(i, &node) || !should_subscribe(node)) {
            continue;
        }
        subscribe_node(node, strcmp(node.device_id, "matter-6") == 0 ? 5 : 0, 60);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

static bool subscription_retry_due(uint64_t node_id, int64_t now_us)
{
    bool due = false;
    portENTER_CRITICAL(&s_sub_lock);
    SubscriptionHealth *health = subscription_health_locked(node_id);
    if (health != nullptr) {
        due = !health->active && !health->connecting && health->retry_at_us > 0 &&
              health->retry_at_us <= now_us;
    }
    portEXIT_CRITICAL(&s_sub_lock);
    return due;
}

static void process_subscription_retries(void)
{
    if (s_quiet) {
        return;
    }
    const int64_t now_us = esp_timer_get_time();
    const int count = homehub_aws_fabric_count();
    for (int i = 0; i < count; ++i) {
        NodeRead node = {};
        if (!copy_fabric_node(i, &node) || !should_subscribe(node) ||
            !subscription_retry_due(node.node_id, now_us)) {
            continue;
        }
        subscribe_node(node, strcmp(node.device_id, "matter-6") == 0 ? 5 : 0, 60);
    }
}

static void quiet_timeout(void *arg)
{
    (void)arg;
    ESP_LOGW(TAG, "Commissioning quiet timed out");
    homehub_matter_set_quiet(0);
}

static void ensure_quiet_timer(void)
{
    if (s_quiet_timer != nullptr) {
        return;
    }
    const esp_timer_create_args_t args = {
        .callback = quiet_timeout,
        .arg = nullptr,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "hh_quiet",
        .skip_unhandled_events = true,
    };
    if (esp_timer_create(&args, &s_quiet_timer) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to create commissioning quiet timer");
    }
}

void homehub_matter_set_quiet(int quiet)
{
    const bool next = quiet != 0;
    if (s_quiet == next) {
        if (next) {
            ensure_quiet_timer();
            if (s_quiet_timer != nullptr) {
                (void)esp_timer_stop(s_quiet_timer);
                (void)esp_timer_start_once(s_quiet_timer, kQuietTimeoutUs);
            }
        }
        return;
    }
    s_quiet = next;
    if (next) {
        homehub_aws_set_quiet(1);
        if (s_subscribed) {
            esp_matter::lock::chip_stack_lock(portMAX_DELAY);
            esp_matter::controller::send_shutdown_all_subscriptions();
            esp_matter::lock::chip_stack_unlock();
            reset_subscription_health();
            s_subscribed = false;
            ESP_LOGI(TAG, "Stopped Matter subscriptions for commissioning");
        }
        ensure_quiet_timer();
        if (s_quiet_timer != nullptr) {
            (void)esp_timer_stop(s_quiet_timer);
            (void)esp_timer_start_once(s_quiet_timer, kQuietTimeoutUs);
        }
        ESP_LOGI(TAG, "Commissioning quiet on");
        return;
    }
    if (s_quiet_timer != nullptr) {
        (void)esp_timer_stop(s_quiet_timer);
    }
    homehub_aws_set_quiet(0);
    ESP_LOGI(TAG, "Commissioning quiet off");
    if (s_task != nullptr) {
        xTaskNotifyGive(s_task);
    }
}

int homehub_matter_quiet(void)
{
    return s_quiet ? 1 : 0;
}

static void finish_pair(const char *event, const char *error)
{
    if (!s_pairing) {
        return;
    }
    s_pairing = false;
    memset(s_pair_payload, 0, sizeof(s_pair_payload));
    snprintf(s_pair_result_event, sizeof(s_pair_result_event), "%s", event ? event : "commission-failed");
    s_pair_result_error[0] = '\0';
    if (error != nullptr && error[0] != '\0') {
        snprintf(s_pair_result_error, sizeof(s_pair_result_error), "%s", error);
    }
    s_pair_result_node = s_pair_node;
    s_pair_result_ready = true;
    homehub_matter_set_quiet(0);
}

static void on_pair_pase(CHIP_ERROR err)
{
    if (err != CHIP_NO_ERROR) {
        finish_pair("commission-failed", "pase failed");
    }
}

static void on_pair_success(chip::ScopedNodeId peer_id)
{
    (void)peer_id;
    finish_pair("commissioned", nullptr);
}

static void on_pair_failure(chip::ScopedNodeId peer_id, CHIP_ERROR error,
                            chip::Controller::CommissioningStage stage,
                            std::optional<chip::Credentials::AttestationVerificationResult> extra)
{
    (void)peer_id;
    (void)error;
    (void)stage;
    (void)extra;
    finish_pair("commission-failed", "pair failed");
}

static void flush_pair_result(void)
{
    if (!s_pair_result_ready) {
        return;
    }
    s_pair_result_ready = false;
    homehub_aws_publish_commission(s_pair_result_event, s_pair_result_node,
                                   s_pair_result_error[0] != '\0' ? s_pair_result_error : nullptr);
}

void homehub_matter_pair(uint64_t node_id, const char *payload)
{
    if (payload == nullptr || payload[0] == '\0') {
        homehub_aws_publish_commission("commission-failed", node_id, "missing code");
        return;
    }
    if (s_pairing) {
        homehub_aws_publish_commission("commission-failed", node_id, "busy");
        return;
    }
    const size_t length = strlen(payload);
    if (length >= sizeof(s_pair_payload)) {
        homehub_aws_publish_commission("commission-failed", node_id, "bad code");
        return;
    }
    memcpy(s_pair_payload, payload, length + 1);
    s_pair_node = node_id;
    s_pairing = true;
    homehub_matter_set_quiet(1);

    otInstance *instance = esp_openthread_get_instance();
    otOperationalDatasetTlvs dataset = {};
    if (instance == nullptr) {
        finish_pair("commission-failed", "no thread");
        return;
    }
    esp_openthread_lock_acquire(portMAX_DELAY);
    const otError dataset_err = otDatasetGetActiveTlvs(instance, &dataset);
    esp_openthread_lock_release();
    if (dataset_err != OT_ERROR_NONE || dataset.mLength == 0) {
        finish_pair("commission-failed", "no dataset");
        return;
    }

    const esp_matter::controller::pairing_command_callbacks_t callbacks = {
        .pase_callback = on_pair_pase,
        .commissioning_success_callback = on_pair_success,
        .commissioning_failure_callback = on_pair_failure,
    };
    esp_matter::controller::pairing_command::get_instance().set_callbacks(callbacks);
    const esp_err_t err = esp_matter::controller::pairing_code_thread(
        node_id, s_pair_payload, dataset.mTlvs, dataset.mLength);
    if (err != ESP_OK) {
        finish_pair("commission-failed", "pair start");
    }
}

static esp_err_t homehub_console_handler(int argc, char **argv)
{
    if (argc < 1 || strcmp(argv[0], "commission") != 0) {
        ESP_LOGI(TAG, "Usage: matter esp homehub commission <on|off>");
        return ESP_ERR_INVALID_ARG;
    }
    if (argc < 2) {
        ESP_LOGI(TAG, "commission quiet=%d", homehub_matter_quiet());
        return ESP_OK;
    }
    if (strcmp(argv[1], "on") == 0) {
        homehub_matter_set_quiet(1);
        return ESP_OK;
    }
    if (strcmp(argv[1], "off") == 0) {
        homehub_matter_set_quiet(0);
        return ESP_OK;
    }
    ESP_LOGI(TAG, "Usage: matter esp homehub commission <on|off>");
    return ESP_ERR_INVALID_ARG;
}

static void register_console(void)
{
    static const esp_matter::console::command_t command = {
        .name = "homehub",
        .description = "HomeHub helpers. Usage: matter esp homehub commission <on|off>",
        .handler = homehub_console_handler,
    };
    (void)esp_matter::console::add_commands(&command, 1);
}

static void homehub_matter_task(void *arg)
{
    (void)arg;
    s_task = xTaskGetCurrentTaskHandle();
    vTaskDelay(pdMS_TO_TICKS(20000));
    homehub_aws_set_command_handler(homehub_matter_apply_command);
    homehub_aws_set_pair_handler(homehub_matter_pair);
    while (true) {
        while (s_quiet) {
            (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
        }
        flush_pair_result();
        const uint32_t generation = homehub_aws_fabric_generation();
        if (!s_subscribed || generation != s_seen_fabric_generation) {
            s_seen_fabric_generation = generation;
            subscribe_live_nodes();
            s_subscribed = true;
        }
        ESP_LOGI(TAG, "Polling Matter fabric");
        apply_pending_light();
        apply_pending_plug();
        const int count = homehub_aws_fabric_count();
        for (int i = 0; i < count; ++i) {
            if (s_quiet) {
                break;
            }
            NodeRead node = {};
            if (!copy_fabric_node(i, &node)) {
                continue;
            }
            apply_pending_light();
            apply_pending_plug();
            (void)read_node(node);
            wait_servicing_commands(300);
        }
        process_subscription_retries();
        if (!s_quiet) {
            (void)homehub_aws_publish_state(nullptr);
            wait_servicing_commands(kPollIntervalMs);
        }
    }
}

void homehub_matter_start(void)
{
    if (s_started) {
        return;
    }
    s_started = true;
    register_console();
    if (xTaskCreate(homehub_matter_task, "homehub_matter", 8192, nullptr, 4, &s_task) != pdPASS) {
        s_started = false;
        ESP_LOGE(TAG, "Failed to start Matter poll task");
    }
}
