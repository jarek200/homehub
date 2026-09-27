#include "homehub_aws.h"

#if defined(ESP_PLATFORM)
#define HOMEHUB_AWS_MQTT 1
#endif

#if defined(HOMEHUB_AWS_MQTT)

#include "homehub_ota.h"
#include <cJSON.h>
#include <esp_event.h>
#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mqtt_client.h>
#include <nvs.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#endif

#ifndef HOMEHUB_IOT_ENABLED
#define HOMEHUB_IOT_ENABLED 0
#endif
#ifndef HOMEHUB_DEVICE_ID
#define HOMEHUB_DEVICE_ID "cores3-gateway"
#endif
#ifndef HOMEHUB_HUB_ID
#define HOMEHUB_HUB_ID "demo"
#endif
#ifndef HOMEHUB_THING_NAME
#define HOMEHUB_THING_NAME "homehub-cores3-gateway"
#endif
#ifndef HOMEHUB_IOT_ENDPOINT
#define HOMEHUB_IOT_ENDPOINT ""
#endif

#if __has_include("esp_matter.h") && __has_include("esp_matter_controller_cluster_command.h")
#define HOMEHUB_AWS_MATTER 1
#include <esp_matter.h>
#include <esp_matter_controller_cluster_command.h>
#endif

static const char *TAG = "homehub_aws";

static constexpr uint32_t kOnOffCluster = 6;
static constexpr uint32_t kOnOffOff = 0;
static constexpr uint32_t kOnOffOn = 1;
static constexpr uint32_t kLevelCluster = 8;
static constexpr uint32_t kMoveToLevel = 0;
static constexpr int kPublishIntervalMs = 60000;
static constexpr int kUrgentPublishDebounceMs = 200;
static constexpr int kMaxReadingDevices = 16;
static constexpr int kMaxMetrics = 8;
static constexpr int kMaxLights = 8;
static constexpr int kMaxPlugs = 8;
static const char kMoveToLevel40[] = "{\"0:U8\":102,\"1:U16\":0}";

struct HomehubMetric {
    char key[24];
    bool is_bool;
    bool flag;
    double number;
};

struct HomehubReading {
    char device_id[24];
    HomehubMetric metrics[kMaxMetrics];
    int count;
};

static esp_mqtt_client_handle_t s_client;
static char s_uri[192];
static char s_state_topic[96];
static char s_events_topic[96];
static char s_alerts_topic[96];
static char s_commands_topic[96];
static char s_ota_topic[96];
static char s_config_topic[96];
static char s_fabric_topic[96];
static bool s_started;
static bool s_connected;
static volatile bool s_quiet;
static volatile bool s_urgent_state_dirty;
static bool s_mqtt_paused;
static TaskHandle_t s_aws_task;
static uint32_t s_state_version;

struct HomehubLight {
    char device_id[20];
    char name[24];
    bool on;
    bool reachable;
    int64_t last_seen_us;
    int brightness;
};

struct HomehubPlug {
    char device_id[20];
    char name[24];
    bool on;
    bool reachable;
    int64_t last_seen_us;
};

static HomehubFabricNode s_fabric[HOMEHUB_FABRIC_MAX];
static int s_fabric_count;
static uint32_t s_fabric_generation = 1;
static bool s_fabric_ready;
static HomehubLight s_lights[kMaxLights];
static int s_light_count;
static HomehubPlug s_plugs[kMaxPlugs];
static int s_plug_count;
static bool fabric_device_stale(const char *device_id);
static bool s_contact_raw_open = false;
static bool s_contact_invert = false;
static bool s_motion_detected = true;
static bool s_has_motion_lux;
static double s_motion_lux;
static bool s_leak = false;
static const char *s_scene = "home";
static int s_alpstuga_attempts;
static int s_alpstuga_completed;
static int s_alpstuga_attributes;
static HomehubReading s_readings[kMaxReadingDevices];
static void (*s_command_handler)(const char *command);
static void (*s_pair_handler)(uint64_t node_id, const char *payload);
static char s_commission_event[24];
static char s_commission_error[48];
static uint64_t s_commission_node;
static bool s_commission_pending;
static void (*s_state_handler)(void);
static void (*s_config_handler)(const char *json);

static constexpr int kHistoryCap = 160;
static constexpr int kHistoryPerDevice = 50;

struct HomehubHistoryEvent {
    char device_id[20];
    char kind[8];
    char value[12];
    char at[21];
};

static HomehubHistoryEvent *s_history;
static int s_history_head;
static int s_history_count;
static portMUX_TYPE s_history_lock = portMUX_INITIALIZER_UNLOCKED;

static HomehubReading *reading_slot(const char *device_id)
{
    if (device_id == nullptr || device_id[0] == '\0') {
        return nullptr;
    }
    for (int i = 0; i < kMaxReadingDevices; ++i) {
        if (strncmp(s_readings[i].device_id, device_id, sizeof(s_readings[i].device_id)) == 0) {
            return &s_readings[i];
        }
    }
    for (int i = 0; i < kMaxReadingDevices; ++i) {
        if (s_readings[i].device_id[0] == '\0') {
            strncpy(s_readings[i].device_id, device_id, sizeof(s_readings[i].device_id) - 1);
            return &s_readings[i];
        }
    }
    return nullptr;
}

static HomehubMetric *metric_slot(HomehubReading *reading, const char *key)
{
    if (reading == nullptr || key == nullptr) {
        return nullptr;
    }
    for (int i = 0; i < reading->count; ++i) {
        if (strcmp(reading->metrics[i].key, key) == 0) {
            return &reading->metrics[i];
        }
    }
    if (reading->count >= kMaxMetrics) {
        return nullptr;
    }
    HomehubMetric *metric = &reading->metrics[reading->count++];
    memset(metric, 0, sizeof(*metric));
    strncpy(metric->key, key, sizeof(metric->key) - 1);
    return metric;
}

static bool metric_number(const char *device_id, const char *key, double *value)
{
    HomehubReading *reading = reading_slot(device_id);
    if (reading == nullptr || value == nullptr) {
        return false;
    }
    for (int i = 0; i < reading->count; ++i) {
        HomehubMetric *metric = &reading->metrics[i];
        if (!metric->is_bool && strcmp(metric->key, key) == 0) {
            *value = metric->number;
            return true;
        }
    }
    return false;
}

static HomehubLight *find_light(const char *device_id)
{
    if (device_id == nullptr) {
        return nullptr;
    }
    for (int i = 0; i < s_light_count; ++i) {
        if (strcmp(s_lights[i].device_id, device_id) == 0) {
            return &s_lights[i];
        }
    }
    return nullptr;
}

void homehub_aws_set_light(const char *device_id, int on, int brightness)
{
    if (device_id == nullptr || device_id[0] == '\0') {
        for (int i = 0; i < s_light_count; ++i) {
            if (on == 0 || on == 1) {
                s_lights[i].on = on != 0;
            }
            if (brightness >= 0) {
                s_lights[i].brightness = brightness;
            }
        }
        return;
    }
    HomehubLight *light = find_light(device_id);
    if (light == nullptr && s_light_count < kMaxLights) {
        light = &s_lights[s_light_count++];
        memset(light, 0, sizeof(*light));
        strncpy(light->device_id, device_id, sizeof(light->device_id) - 1);
        light->on = true;
        light->reachable = true;
        light->brightness = 100;
    }
    if (light == nullptr) {
        return;
    }
    if (on == 0 || on == 1) {
        light->on = on != 0;
    }
    if (brightness >= 0) {
        light->brightness = brightness;
    }
}

void homehub_aws_set_plug(const char *device_id, int on)
{
    if (on != 0 && on != 1) {
        return;
    }
    if (device_id == nullptr || device_id[0] == '\0') {
        for (int i = 0; i < s_plug_count; ++i) {
            s_plugs[i].on = on != 0;
        }
        return;
    }
    for (int i = 0; i < s_plug_count; ++i) {
        if (strcmp(s_plugs[i].device_id, device_id) == 0) {
            s_plugs[i].on = on != 0;
            return;
        }
    }
    if (s_plug_count >= kMaxPlugs) {
        return;
    }
    HomehubPlug *plug = &s_plugs[s_plug_count++];
    memset(plug, 0, sizeof(*plug));
    strncpy(plug->device_id, device_id, sizeof(plug->device_id) - 1);
    plug->on = on != 0;
    plug->reachable = true;
}

static HomehubPlug *find_plug(const char *device_id)
{
    if (device_id == nullptr) {
        return nullptr;
    }
    for (int i = 0; i < s_plug_count; ++i) {
        if (strcmp(s_plugs[i].device_id, device_id) == 0) {
            return &s_plugs[i];
        }
    }
    return nullptr;
}

int homehub_aws_set_reachable(const char *device_id, int reachable)
{
    if (device_id == nullptr || device_id[0] == '\0') {
        return 0;
    }
    const bool next = reachable != 0;
    const int64_t now = next ? esp_timer_get_time() : 0;
    int changed = 0;
    HomehubLight *light = find_light(device_id);
    if (light != nullptr) {
        if (next) {
            light->last_seen_us = now;
        }
        if (light->reachable != next) {
            light->reachable = next;
            changed = 1;
        }
    }
    HomehubPlug *plug = find_plug(device_id);
    if (plug != nullptr) {
        if (next) {
            plug->last_seen_us = now;
        }
        if (plug->reachable != next) {
            plug->reachable = next;
            changed = 1;
        }
    }
    return changed;
}

int homehub_aws_expire_reachable(void)
{
    int changed = 0;
    for (int i = 0; i < s_light_count; ++i) {
        if (s_lights[i].reachable && fabric_device_stale(s_lights[i].device_id)) {
            s_lights[i].reachable = false;
            changed = 1;
        }
    }
    for (int i = 0; i < s_plug_count; ++i) {
        if (s_plugs[i].reachable && fabric_device_stale(s_plugs[i].device_id)) {
            s_plugs[i].reachable = false;
            changed = 1;
        }
    }
    return changed;
}

int homehub_aws_is_reachable(const char *device_id)
{
    HomehubLight *light = find_light(device_id);
    if (light != nullptr) {
        return light->reachable ? 1 : 0;
    }
    HomehubPlug *plug = find_plug(device_id);
    if (plug != nullptr) {
        return plug->reachable ? 1 : 0;
    }
    return 1;
}

int homehub_aws_liveness_paused(void)
{
    return (s_quiet || homehub_ota_busy()) ? 1 : 0;
}

static void load_default_fabric(void);
static void now_iso(char *out, size_t len);
static void maybe_publish_metric_alert(const char *device_id, const char *key, bool next);

static bool contact_is_open(void)
{
    return s_contact_invert ? !s_contact_raw_open : s_contact_raw_open;
}

static void persist_contact_invert(void)
{
    nvs_handle_t nvs = 0;
    if (nvs_open("homehub_aws", NVS_READWRITE, &nvs) != ESP_OK) {
        return;
    }
    (void)nvs_set_u8(nvs, "cinv", s_contact_invert ? 1 : 0);
    (void)nvs_commit(nvs);
    nvs_close(nvs);
}

static void load_contact_invert(void)
{
    nvs_handle_t nvs = 0;
    if (nvs_open("homehub_aws", NVS_READONLY, &nvs) != ESP_OK) {
        return;
    }
    uint8_t invert = 0;
    if (nvs_get_u8(nvs, "cinv", &invert) == ESP_OK) {
        s_contact_invert = invert != 0;
    }
    nvs_close(nvs);
}

static void persist_motion_lux(void)
{
    nvs_handle_t nvs = 0;
    if (nvs_open("homehub_aws", NVS_READWRITE, &nvs) != ESP_OK) {
        return;
    }
    if (s_has_motion_lux) {
        (void)nvs_set_i32(nvs, "mlux", static_cast<int32_t>(s_motion_lux >= 0 ? s_motion_lux + 0.5 : s_motion_lux - 0.5));
        (void)nvs_set_u8(nvs, "mluxok", 1);
    }
    (void)nvs_commit(nvs);
    nvs_close(nvs);
}

static void load_motion_lux(void)
{
    nvs_handle_t nvs = 0;
    if (nvs_open("homehub_aws", NVS_READONLY, &nvs) != ESP_OK) {
        return;
    }
    uint8_t ok = 0;
    int32_t lux = 0;
    if (nvs_get_u8(nvs, "mluxok", &ok) == ESP_OK && ok != 0 && nvs_get_i32(nvs, "mlux", &lux) == ESP_OK) {
        s_motion_lux = lux;
        s_has_motion_lux = true;
    }
    nvs_close(nvs);
}

void homehub_aws_set_contact(int open)
{
    s_contact_raw_open = open != 0;
}

void homehub_aws_set_contact_invert(int invert)
{
    const bool next = invert != 0;
    if (s_contact_invert == next) {
        return;
    }
    const bool previous_open = contact_is_open();
    s_contact_invert = next;
    persist_contact_invert();
    load_default_fabric();
    const bool now_open = contact_is_open();
    const char *value = now_open ? "OPEN" : "CLOSED";
    bool published_open = false;
    for (int i = 0; i < s_fabric_count; ++i) {
        if (strcmp(s_fabric[i].type, "contact") != 0) {
            continue;
        }
        homehub_history_add(s_fabric[i].device_id, "contact", value);
        HomehubMetric *metric = metric_slot(reading_slot(s_fabric[i].device_id), "open");
        if (metric != nullptr) {
            metric->is_bool = true;
            metric->flag = now_open;
        }
        if (!previous_open && now_open && !published_open) {
            maybe_publish_metric_alert(s_fabric[i].device_id, "open", true);
            published_open = true;
        }
    }
}

int homehub_aws_contact_invert(void)
{
    return s_contact_invert ? 1 : 0;
}

void homehub_aws_set_motion(int detected)
{
    s_motion_detected = detected != 0;
}

void homehub_aws_set_leak(int leak)
{
    s_leak = leak != 0;
}

void homehub_aws_set_metric(const char *device_id, const char *key, double value)
{
    HomehubMetric *metric = metric_slot(reading_slot(device_id), key);
    if (metric == nullptr) {
        return;
    }
    metric->is_bool = false;
    metric->number = value;
    if (key != nullptr && strcmp(key, "lightLux") == 0) {
        s_motion_lux = value;
        s_has_motion_lux = true;
        persist_motion_lux();
    }
}

int homehub_aws_has_metric(const char *device_id, const char *key)
{
    double value = 0;
    return metric_number(device_id, key, &value) ||
                   (key != nullptr && strcmp(key, "lightLux") == 0 && s_has_motion_lux)
               ? 1
               : 0;
}

void homehub_aws_set_metric_bool(const char *device_id, const char *key, int value)
{
    HomehubReading *reading = reading_slot(device_id);
    bool had = false;
    bool previous = false;
    if (reading != nullptr && key != nullptr) {
        for (int i = 0; i < reading->count; ++i) {
            if (strcmp(reading->metrics[i].key, key) == 0) {
                had = reading->metrics[i].is_bool;
                previous = reading->metrics[i].flag;
                break;
            }
        }
    }
    HomehubMetric *metric = metric_slot(reading, key);
    if (metric == nullptr) {
        return;
    }
    const bool next =
        key != nullptr && strcmp(key, "open") == 0 ? contact_is_open() : value != 0;
    metric->is_bool = true;
    metric->flag = next;
    if (had && previous == next) {
        return;
    }
    if (key != nullptr && strcmp(key, "occupied") == 0) {
        homehub_history_add(device_id, "motion", next ? "DETECTED" : "CLEAR");
    } else if (key != nullptr && strcmp(key, "open") == 0) {
        homehub_history_add(device_id, "contact", contact_is_open() ? "OPEN" : "CLOSED");
    } else if (key != nullptr && strcmp(key, "leak") == 0) {
        homehub_history_add(device_id, "leak", next ? "LEAK" : "DRY");
    }
    if (had) {
        maybe_publish_metric_alert(device_id, key, next);
    }
}

void homehub_aws_set_alpstuga_diagnostics(int attempts, int completed, int attributes)
{
    s_alpstuga_attempts = attempts;
    s_alpstuga_completed = completed;
    s_alpstuga_attributes = attributes;
}

void homehub_aws_set_command_handler(void (*handler)(const char *command))
{
    s_command_handler = handler;
}

void homehub_aws_set_pair_handler(void (*handler)(uint64_t node_id, const char *payload))
{
    s_pair_handler = handler;
}

void homehub_aws_set_state_handler(void (*handler)(void))
{
    s_state_handler = handler;
}

void homehub_aws_set_config_handler(void (*handler)(const char *json))
{
    s_config_handler = handler;
}

static void add_default_node(uint64_t node_id, const char *device_id, const char *name, const char *type,
                             const uint16_t *endpoints, const uint32_t *clusters, uint8_t count)
{
    if (s_fabric_count >= HOMEHUB_FABRIC_MAX) {
        return;
    }
    HomehubFabricNode *node = &s_fabric[s_fabric_count++];
    memset(node, 0, sizeof(*node));
    node->node_id = node_id;
    strncpy(node->device_id, device_id, sizeof(node->device_id) - 1);
    strncpy(node->name, name, sizeof(node->name) - 1);
    strncpy(node->type, type, sizeof(node->type) - 1);
    node->last_seen_us = esp_timer_get_time();
    node->count = count;
    for (uint8_t i = 0; i < count && i < HOMEHUB_FABRIC_READS; ++i) {
        node->endpoints[i] = endpoints[i];
        node->clusters[i] = clusters[i];
        node->attributes[i] = clusters[i] == 0x002F ? 0x000C : 0;
    }
}

static void sync_household_from_fabric(void)
{
    HomehubLight previous_lights[kMaxLights];
    const int previous_light_count = s_light_count;
    memcpy(previous_lights, s_lights, sizeof(previous_lights));
    HomehubPlug previous_plugs[kMaxPlugs];
    const int previous_plug_count = s_plug_count;
    memcpy(previous_plugs, s_plugs, sizeof(previous_plugs));
    s_light_count = 0;
    s_plug_count = 0;
    for (int i = 0; i < s_fabric_count; ++i) {
        const HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->type, "light") == 0 && s_light_count < kMaxLights) {
            HomehubLight *light = &s_lights[s_light_count++];
            memset(light, 0, sizeof(*light));
            strncpy(light->device_id, node->device_id, sizeof(light->device_id) - 1);
            strncpy(light->name, node->name, sizeof(light->name) - 1);
            light->on = true;
            light->reachable = true;
            light->brightness = 100;
            for (int j = 0; j < previous_light_count; ++j) {
                if (strcmp(previous_lights[j].device_id, node->device_id) == 0) {
                    light->on = previous_lights[j].on;
                    light->reachable = previous_lights[j].reachable;
                    light->last_seen_us = previous_lights[j].last_seen_us;
                    light->brightness = previous_lights[j].brightness;
                    break;
                }
            }
        } else if (strcmp(node->type, "plug") == 0 && s_plug_count < kMaxPlugs) {
            HomehubPlug *plug = &s_plugs[s_plug_count++];
            memset(plug, 0, sizeof(*plug));
            strncpy(plug->device_id, node->device_id, sizeof(plug->device_id) - 1);
            strncpy(plug->name, node->name, sizeof(plug->name) - 1);
            plug->on = true;
            plug->reachable = true;
            for (int j = 0; j < previous_plug_count; ++j) {
                if (strcmp(previous_plugs[j].device_id, node->device_id) == 0) {
                    plug->on = previous_plugs[j].on;
                    plug->reachable = previous_plugs[j].reachable;
                    plug->last_seen_us = previous_plugs[j].last_seen_us;
                    break;
                }
            }
        }
    }
}

static void load_default_fabric(void)
{
    if (s_fabric_ready) {
        return;
    }
    const uint16_t ep1[] = {1};
    const uint16_t ep11[] = {1, 1};
    const uint16_t ep12_battery[] = {1, 2, 0};
    const uint16_t ep21_battery[] = {2, 1, 0};
    const uint16_t ep1_battery[] = {1, 0};
    const uint16_t ep_air[] = {1, 1, 1, 1, 1, 0};
    const uint32_t onoff_level[] = {kOnOffCluster, kLevelCluster};
    const uint32_t onoff[] = {kOnOffCluster};
    const uint32_t temp_hum_battery[] = {0x0402, 0x0405, 0x002F};
    const uint32_t occ_lux_battery[] = {0x0406, 0x0400, 0x002F};
    const uint32_t boolean_state_battery[] = {0x0045, 0x002F};
    const uint32_t air[] = {0x0402, 0x0405, 0x040D, 0x042A, 0x005B, 0x002F};
    add_default_node(7, "matter-6", "ALPSTUGA", "climate", ep_air, air, 6);
    add_default_node(1, "matter-1", "KAJPLATS", "light", ep11, onoff_level, 2);
    add_default_node(2, "matter-2", "TIMMERFLOTTE 1", "climate", ep12_battery, temp_hum_battery, 3);
    add_default_node(3, "matter-3", "TIMMERFLOTTE 2", "climate", ep12_battery, temp_hum_battery, 3);
    add_default_node(4, "matter-4", "MYGGSPRAY", "motion", ep21_battery, occ_lux_battery, 3);
    add_default_node(5, "matter-5", "MYGGBETT", "contact", ep1_battery, boolean_state_battery, 2);
    add_default_node(9, "matter-7", "KLIPPBOK", "leak", ep1_battery, boolean_state_battery, 2);
    add_default_node(10, "matter-9", "GRILLPLATS", "plug", ep1, onoff, 1);
    add_default_node(11, "matter-10", "GRILLPLATS 2", "plug", ep1, onoff, 1);
    sync_household_from_fabric();
    s_fabric_ready = true;
}

void homehub_aws_apply_fabric(const char *json)
{
    if (json == nullptr || json[0] == '\0') {
        return;
    }
    cJSON *root = cJSON_Parse(json);
    const cJSON *kind = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "kind") : nullptr;
    const cJSON *devices = root != nullptr ? cJSON_GetObjectItemCaseSensitive(root, "devices") : nullptr;
    if (!cJSON_IsString(kind) || kind->valuestring == nullptr || strcmp(kind->valuestring, "fabric") != 0 ||
        !cJSON_IsArray(devices)) {
        ESP_LOGW(TAG, "Rejected invalid fabric config");
        cJSON_Delete(root);
        return;
    }
    HomehubFabricNode next[HOMEHUB_FABRIC_MAX] = {};
    int count = 0;
    const cJSON *device = nullptr;
    cJSON_ArrayForEach(device, devices) {
        if (count >= HOMEHUB_FABRIC_MAX || !cJSON_IsObject(device)) {
            continue;
        }
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(device, "id");
        const cJSON *name = cJSON_GetObjectItemCaseSensitive(device, "name");
        const cJSON *type = cJSON_GetObjectItemCaseSensitive(device, "type");
        const cJSON *node = cJSON_GetObjectItemCaseSensitive(device, "n");
        const cJSON *reads = cJSON_GetObjectItemCaseSensitive(device, "reads");
        if (!cJSON_IsString(id) || id->valuestring == nullptr || !cJSON_IsNumber(node) || !cJSON_IsArray(reads)) {
            continue;
        }
        HomehubFabricNode *item = &next[count];
        memset(item, 0, sizeof(*item));
        item->node_id = static_cast<uint64_t>(node->valuedouble);
        strncpy(item->device_id, id->valuestring, sizeof(item->device_id) - 1);
        strncpy(item->name, cJSON_IsString(name) && name->valuestring ? name->valuestring : id->valuestring,
                sizeof(item->name) - 1);
        strncpy(item->type, cJSON_IsString(type) && type->valuestring ? type->valuestring : "climate",
                sizeof(item->type) - 1);
        item->last_seen_us = esp_timer_get_time();
        const cJSON *read = nullptr;
        cJSON_ArrayForEach(read, reads) {
            if (item->count >= HOMEHUB_FABRIC_READS || !cJSON_IsObject(read)) {
                continue;
            }
            const cJSON *endpoint = cJSON_GetObjectItemCaseSensitive(read, "e");
            const cJSON *cluster = cJSON_GetObjectItemCaseSensitive(read, "c");
            const cJSON *attr = cJSON_GetObjectItemCaseSensitive(read, "a");
            if (!cJSON_IsNumber(endpoint) || !cJSON_IsNumber(cluster)) {
                continue;
            }
            item->endpoints[item->count] = static_cast<uint16_t>(endpoint->valueint);
            item->clusters[item->count] = static_cast<uint32_t>(cluster->valuedouble);
            item->attributes[item->count] = cJSON_IsNumber(attr) ? static_cast<uint32_t>(attr->valueint) : 0;
            item->count++;
        }
        if (item->count > 0) {
            count++;
        }
    }
    cJSON_Delete(root);
    if (count <= 0) {
        ESP_LOGW(TAG, "Rejected empty fabric config");
        return;
    }
    memcpy(s_fabric, next, sizeof(s_fabric));
    s_fabric_count = count;
    s_fabric_ready = true;
    sync_household_from_fabric();
    s_fabric_generation++;
    ESP_LOGI(TAG, "Updated fabric devices=%d gen=%u", s_fabric_count, static_cast<unsigned>(s_fabric_generation));
}

int homehub_aws_fabric_count(void)
{
    load_default_fabric();
    return s_fabric_count;
}

uint32_t homehub_aws_fabric_generation(void)
{
    load_default_fabric();
    return s_fabric_generation;
}

int homehub_aws_mark_seen(const char *device_id)
{
    if (device_id == nullptr) {
        return 0;
    }
    load_default_fabric();
    for (int i = 0; i < s_fabric_count; ++i) {
        HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->device_id, device_id) != 0) {
            continue;
        }
        const int changed = node->stale ? 1 : 0;
        node->last_seen_us = esp_timer_get_time();
        node->stale = false;
        return changed;
    }
    return 0;
}

int homehub_aws_mark_stale(const char *device_id)
{
    if (device_id == nullptr) {
        return 0;
    }
    load_default_fabric();
    for (int i = 0; i < s_fabric_count; ++i) {
        HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->device_id, device_id) != 0) {
            continue;
        }
        const int changed = node->stale ? 0 : 1;
        node->stale = true;
        return changed;
    }
    return 0;
}

static bool fabric_device_stale(const char *device_id)
{
    for (int i = 0; i < s_fabric_count; ++i) {
        if (strcmp(s_fabric[i].device_id, device_id) == 0) {
            return s_fabric[i].stale;
        }
    }
    return false;
}

int homehub_aws_copy_fabric_node(int index, HomehubFabricNode *out)
{
    load_default_fabric();
    if (out == nullptr || index < 0 || index >= s_fabric_count) {
        return -1;
    }
    *out = s_fabric[index];
    return 0;
}

const char *homehub_aws_device_id_for_node(uint64_t node_id)
{
    load_default_fabric();
    for (int i = 0; i < s_fabric_count; ++i) {
        if (s_fabric[i].node_id == node_id) {
            return s_fabric[i].device_id;
        }
    }
    return nullptr;
}

uint64_t homehub_aws_node_id_for_device(const char *device_id)
{
    load_default_fabric();
    if (device_id == nullptr || device_id[0] == '\0') {
        return 0;
    }
    for (int i = 0; i < s_fabric_count; ++i) {
        if (strcmp(s_fabric[i].device_id, device_id) == 0) {
            return s_fabric[i].node_id;
        }
    }
    return 0;
}

const char *homehub_aws_device_type(const char *device_id)
{
    load_default_fabric();
    if (device_id == nullptr) {
        return nullptr;
    }
    for (int i = 0; i < s_fabric_count; ++i) {
        if (strcmp(s_fabric[i].device_id, device_id) == 0) {
            return s_fabric[i].type;
        }
    }
    return nullptr;
}

void homehub_aws_notify_state_changed(void)
{
    if (s_state_handler != nullptr) {
        s_state_handler();
    }
}

void homehub_aws_publish_state_soon(void)
{
    s_urgent_state_dirty = true;
    if (s_aws_task != nullptr) {
        xTaskNotifyGive(s_aws_task);
    }
}

static void now_iso(char *out, size_t len)
{
    time_t now = time(nullptr);
    struct tm utc {};
    gmtime_r(&now, &utc);
    strftime(out, len, "%Y-%m-%dT%H:%M:%SZ", &utc);
}

static bool scene_is_away(void)
{
    return s_scene != nullptr && strcmp(s_scene, "away") == 0;
}

static const char *fabric_device_name(const char *device_id, const char *fallback)
{
    load_default_fabric();
    if (device_id != nullptr) {
        for (int i = 0; i < s_fabric_count; ++i) {
            if (strcmp(s_fabric[i].device_id, device_id) == 0 && s_fabric[i].name[0] != '\0') {
                return s_fabric[i].name;
            }
        }
    }
    return fallback != nullptr ? fallback : "";
}

static void publish_household_alert(const char *event_name, const char *device_id, const char *fallback_name,
                                    const char *message_prefix)
{
    if (!s_connected || s_client == nullptr || event_name == nullptr || message_prefix == nullptr) {
        return;
    }
    const char *name = fabric_device_name(device_id, fallback_name);
    char timestamp[32];
    now_iso(timestamp, sizeof(timestamp));
    char message[96];
    snprintf(message, sizeof(message), "%s%s", message_prefix, name);

    cJSON *root = cJSON_CreateObject();
    if (root == nullptr) {
        return;
    }
    cJSON_AddStringToObject(root, "event", event_name);
    cJSON_AddStringToObject(root, "gatewayId", HOMEHUB_DEVICE_ID);
    if (device_id != nullptr && device_id[0] != '\0') {
        cJSON_AddStringToObject(root, "deviceId", device_id);
    }
    cJSON_AddStringToObject(root, "name", name);
    cJSON_AddStringToObject(root, "scene", s_scene != nullptr ? s_scene : "home");
    cJSON_AddStringToObject(root, "message", message);
    cJSON_AddStringToObject(root, "recordedAt", timestamp);
    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (printed == nullptr) {
        return;
    }
    (void)esp_mqtt_client_publish(s_client, s_alerts_topic, printed, 0, 1, 0);
    free(printed);
    ESP_LOGI(TAG, "Published alert %s", event_name);
}

static void maybe_publish_metric_alert(const char *device_id, const char *key, bool next)
{
    if (!next || key == nullptr) {
        return;
    }
    if (strcmp(key, "leak") == 0) {
        publish_household_alert("leak", device_id, "leak", "HomeHub: Leak at ");
        return;
    }
    if (!scene_is_away()) {
        return;
    }
    if (strcmp(key, "open") == 0) {
        publish_household_alert("contact", device_id, "door", "HomeHub: Door opened — ");
        return;
    }
    if (strcmp(key, "occupied") == 0) {
        publish_household_alert("motion", device_id, "motion", "HomeHub: Motion — ");
    }
}

static void history_ensure(void)
{
    if (s_history != nullptr) {
        return;
    }
    s_history = static_cast<HomehubHistoryEvent *>(heap_caps_calloc(
        kHistoryCap, sizeof(HomehubHistoryEvent), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
}

void homehub_history_add(const char *device_id, const char *kind, const char *value)
{
    if (device_id == nullptr || device_id[0] == '\0' || kind == nullptr || value == nullptr) {
        return;
    }
    if (strcmp(value, "OPEN") != 0 && strcmp(value, "DETECTED") != 0 &&
        strcmp(value, "LEAK") != 0) {
        return;
    }
    history_ensure();
    if (s_history == nullptr) {
        return;
    }
    HomehubHistoryEvent event {};
    strncpy(event.device_id, device_id, sizeof(event.device_id) - 1);
    strncpy(event.kind, kind, sizeof(event.kind) - 1);
    strncpy(event.value, value, sizeof(event.value) - 1);
    now_iso(event.at, sizeof(event.at));
    portENTER_CRITICAL(&s_history_lock);
    s_history[s_history_head] = event;
    s_history_head = (s_history_head + 1) % kHistoryCap;
    if (s_history_count < kHistoryCap) {
        s_history_count += 1;
    }
    portEXIT_CRITICAL(&s_history_lock);
}

static void history_append_event(cJSON *events, const HomehubHistoryEvent *event)
{
    if (events == nullptr || event == nullptr) {
        return;
    }
    cJSON *item = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "kind", event->kind);
    cJSON_AddStringToObject(item, "at", event->at);
    cJSON_AddStringToObject(item, "value", event->value);
    cJSON_AddItemToArray(events, item);
}

char *homehub_history_json(const char *device_id)
{
    const bool all = device_id == nullptr || device_id[0] == '\0';
    cJSON *root = cJSON_CreateObject();
    if (!all) {
        cJSON_AddStringToObject(root, "id", device_id);
    }
    auto *snapshot = static_cast<HomehubHistoryEvent *>(heap_caps_malloc(
        kHistoryCap * sizeof(HomehubHistoryEvent), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    int found = 0;
    if (snapshot != nullptr && s_history != nullptr) {
        portENTER_CRITICAL(&s_history_lock);
        for (int i = 0; i < s_history_count && found < kHistoryCap; ++i) {
            int index = s_history_head - 1 - i;
            if (index < 0) {
                index += kHistoryCap;
            }
            if (all || strcmp(s_history[index].device_id, device_id) == 0) {
                snapshot[found++] = s_history[index];
                if (!all && found >= kHistoryPerDevice) {
                    break;
                }
            }
        }
        portEXIT_CRITICAL(&s_history_lock);
    }
    if (all) {
        cJSON *devices = cJSON_AddObjectToObject(root, "devices");
        for (int i = 0; i < found; ++i) {
            cJSON *device = cJSON_GetObjectItemCaseSensitive(devices, snapshot[i].device_id);
            if (device == nullptr) {
                device = cJSON_AddObjectToObject(devices, snapshot[i].device_id);
                cJSON_AddStringToObject(device, "kind", snapshot[i].kind);
                cJSON_AddArrayToObject(device, "events");
            }
            cJSON *events = cJSON_GetObjectItemCaseSensitive(device, "events");
            if (events == nullptr || cJSON_GetArraySize(events) >= kHistoryPerDevice) {
                continue;
            }
            history_append_event(events, &snapshot[i]);
        }
    } else {
        cJSON *events = cJSON_AddArrayToObject(root, "events");
        if (found > 0) {
            cJSON_AddStringToObject(root, "kind", snapshot[0].kind);
        }
        for (int i = 0; i < found; ++i) {
            history_append_event(events, &snapshot[i]);
        }
    }
    heap_caps_free(snapshot);
    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (printed == nullptr) {
        return nullptr;
    }
    const size_t length = strlen(printed);
    auto *copy = static_cast<char *>(heap_caps_malloc(length + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (copy == nullptr) {
        free(printed);
        return nullptr;
    }
    memcpy(copy, printed, length + 1);
    free(printed);
    return copy;
}

static bool sta_has_ip(void)
{
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif == nullptr) {
        return false;
    }
    esp_netif_ip_info_t info {};
    if (esp_netif_get_ip_info(netif, &info) != ESP_OK) {
        return false;
    }
    return info.ip.addr != 0;
}

static bool wait_for_wifi(void)
{
    for (int attempt = 0; attempt < 90; ++attempt) {
        if (sta_has_ip()) {
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    return false;
}

static bool wait_for_time(void)
{
    if (time(nullptr) > 1700000000) {
        return true;
    }
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_setservername(1, "time.nist.gov");
    esp_sntp_init();
    for (int attempt = 0; attempt < 40; ++attempt) {
        if (time(nullptr) > 1700000000) {
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    return false;
}

#ifdef HOMEHUB_AWS_MATTER
static void invoke_light_nodes(bool on, int brightness)
{
    load_default_fabric();
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    for (int i = 0; i < s_fabric_count; ++i) {
        const HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->type, "light") != 0) {
            continue;
        }
        uint16_t endpoint = 1;
        for (uint8_t r = 0; r < node->count; ++r) {
            if (node->clusters[r] == kOnOffCluster) {
                endpoint = node->endpoints[r];
                break;
            }
        }
        esp_err_t err = esp_matter::controller::send_invoke_cluster_command(
            node->node_id, endpoint, kOnOffCluster, on ? kOnOffOn : kOnOffOff, nullptr);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "OnOff invoke node %llu failed: %s",
                     static_cast<unsigned long long>(node->node_id), esp_err_to_name(err));
        }
        if (brightness >= 0) {
            err = esp_matter::controller::send_invoke_cluster_command(
                node->node_id, endpoint, kLevelCluster, kMoveToLevel, kMoveToLevel40);
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "Level invoke node %llu failed: %s",
                         static_cast<unsigned long long>(node->node_id), esp_err_to_name(err));
            }
        }
    }
    esp_matter::lock::chip_stack_unlock();
}

static void invoke_plug_nodes(bool on)
{
    load_default_fabric();
    esp_matter::lock::chip_stack_lock(portMAX_DELAY);
    for (int i = 0; i < s_fabric_count; ++i) {
        const HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->type, "plug") != 0) {
            continue;
        }
        uint16_t endpoint = 1;
        for (uint8_t r = 0; r < node->count; ++r) {
            if (node->clusters[r] == kOnOffCluster) {
                endpoint = node->endpoints[r];
                break;
            }
        }
        const esp_err_t err = esp_matter::controller::send_invoke_cluster_command(
            node->node_id, endpoint, kOnOffCluster, on ? kOnOffOn : kOnOffOff, nullptr);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "Plug OnOff invoke node %llu failed: %s",
                     static_cast<unsigned long long>(node->node_id), esp_err_to_name(err));
        }
    }
    esp_matter::lock::chip_stack_unlock();
}
#endif

static void apply_command(const char *command)
{
    if (command == nullptr) {
        return;
    }
    load_default_fabric();
    if (strcmp(command, "all-lights-off") == 0) {
        homehub_aws_set_light(nullptr, 0, -1);
        if (strcmp(s_scene, "evening") == 0) {
            s_scene = "home";
        }
#ifdef HOMEHUB_AWS_MATTER
        invoke_light_nodes(false, -1);
#endif
        if (s_command_handler != nullptr) {
            s_command_handler(command);
        }
        return;
    }
    if (strcmp(command, "all-plugs-off") == 0) {
        homehub_aws_set_plug(nullptr, 0);
#ifdef HOMEHUB_AWS_MATTER
        invoke_plug_nodes(false);
#endif
        if (s_command_handler != nullptr) {
            s_command_handler(command);
        }
        return;
    }
    if (strcmp(command, "away") == 0) {
        s_scene = "away";
        if (s_command_handler != nullptr) {
            s_command_handler(command);
        }
        return;
    }
    if (strcmp(command, "evening") == 0) {
        homehub_aws_set_light(nullptr, 1, 40);
        s_scene = "evening";
#ifdef HOMEHUB_AWS_MATTER
        invoke_light_nodes(true, 40);
#endif
        if (s_command_handler != nullptr) {
            s_command_handler(command);
        }
        return;
    }
    if (strcmp(command, "home") == 0) {
        s_scene = "home";
        if (s_command_handler != nullptr) {
            s_command_handler(command);
        }
        return;
    }
    ESP_LOGI(TAG, "Ignoring command %s", command);
    if (s_command_handler != nullptr) {
        s_command_handler(command);
    }
}

void homehub_aws_on_command(const char *json)
{
    if (json == nullptr || json[0] == '\0') {
        return;
    }
    cJSON *root = cJSON_Parse(json);
    if (root == nullptr) {
        ESP_LOGW(TAG, "Command JSON parse failed");
        return;
    }
    const cJSON *command = cJSON_GetObjectItemCaseSensitive(root, "command");
    if (cJSON_IsString(command) && command->valuestring != nullptr) {
        ESP_LOGI(TAG, "Command %s", command->valuestring);
        if (strcmp(command->valuestring, "ota") == 0) {
            const cJSON *url = cJSON_GetObjectItemCaseSensitive(root, "url");
            if (cJSON_IsString(url) && url->valuestring != nullptr) {
                (void)homehub_ota_request(url->valuestring);
            } else {
                ESP_LOGW(TAG, "OTA command missing url");
            }
        } else if (strcmp(command->valuestring, "pair") == 0) {
            const cJSON *node = cJSON_GetObjectItemCaseSensitive(root, "node");
            const cJSON *code = cJSON_GetObjectItemCaseSensitive(root, "code");
            if (cJSON_IsNumber(node) && cJSON_IsString(code) && code->valuestring != nullptr &&
                s_pair_handler != nullptr) {
                s_pair_handler(static_cast<uint64_t>(node->valuedouble), code->valuestring);
            } else {
                ESP_LOGW(TAG, "Pair command missing node or code");
            }
        } else {
            apply_command(command->valuestring);
        }
    }
    cJSON_Delete(root);
    (void)homehub_aws_publish_state(nullptr);
}

static void snapshot_heap(cJSON *state)
{
    const double spiram_free = static_cast<double>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    const double internal_free =
        static_cast<double>(heap_caps_get_free_size(MALLOC_CAP_8BIT)) - spiram_free;
    const double internal_largest =
        static_cast<double>(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    const double spiram_largest =
        static_cast<double>(heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM));
    const double internal_min =
        static_cast<double>(heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
    const double spiram_min = static_cast<double>(heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM));

    cJSON *memory = cJSON_AddObjectToObject(state, "memory");
    cJSON_AddNumberToObject(memory, "internalFree", internal_free);
    cJSON_AddNumberToObject(memory, "internalLargest", internal_largest);
    cJSON_AddNumberToObject(memory, "internalMinFree", internal_min);
    cJSON_AddNumberToObject(memory, "spiramFree", spiram_free);
    cJSON_AddNumberToObject(memory, "spiramLargest", spiram_largest);
    cJSON_AddNumberToObject(memory, "spiramMinFree", spiram_min);

    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapInternalFree", internal_free);
    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapInternalLargest", internal_largest);
    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapInternalMinFree", internal_min);
    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapSpiramFree", spiram_free);
    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapSpiramLargest", spiram_largest);
    homehub_aws_set_metric(HOMEHUB_DEVICE_ID, "heapSpiramMinFree", spiram_min);
}

char *homehub_aws_build_state_json(void)
{
    load_default_fabric();
    char timestamp[32];
    now_iso(timestamp, sizeof(timestamp));

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "hubId", HOMEHUB_HUB_ID);
    cJSON_AddStringToObject(root, "gatewayId", HOMEHUB_DEVICE_ID);
    cJSON_AddStringToObject(root, "recordedAt", timestamp);

    cJSON *state = cJSON_AddObjectToObject(root, "state");
    cJSON *lights = cJSON_AddArrayToObject(state, "lights");
    for (int i = 0; i < s_light_count; ++i) {
        cJSON *light = cJSON_CreateObject();
        cJSON_AddStringToObject(light, "id", s_lights[i].device_id);
        cJSON_AddStringToObject(light, "name", s_lights[i].name);
        cJSON_AddBoolToObject(light, "on", s_lights[i].on);
        cJSON_AddBoolToObject(light, "reachable", s_lights[i].reachable);
        cJSON_AddBoolToObject(light, "stale", fabric_device_stale(s_lights[i].device_id));
        cJSON_AddNumberToObject(light, "brightness", s_lights[i].brightness);
        cJSON_AddItemToArray(lights, light);
    }

    cJSON *plugs = cJSON_AddArrayToObject(state, "plugs");
    for (int i = 0; i < s_plug_count; ++i) {
        cJSON *plug = cJSON_CreateObject();
        cJSON_AddStringToObject(plug, "id", s_plugs[i].device_id);
        cJSON_AddStringToObject(plug, "name", s_plugs[i].name);
        cJSON_AddBoolToObject(plug, "on", s_plugs[i].on);
        cJSON_AddBoolToObject(plug, "reachable", s_plugs[i].reachable);
        cJSON_AddBoolToObject(plug, "stale", fabric_device_stale(s_plugs[i].device_id));
        cJSON_AddItemToArray(plugs, plug);
    }

    cJSON *contacts = cJSON_AddArrayToObject(state, "contacts");
    cJSON *motions = cJSON_AddArrayToObject(state, "motions");
    cJSON *climates = cJSON_AddArrayToObject(state, "climates");
    cJSON *leaks = cJSON_AddArrayToObject(state, "leaks");
    int contact_index = 0;
    int motion_index = 0;
    int leak_index = 0;
    for (int i = 0; i < s_fabric_count; ++i) {
        const HomehubFabricNode *node = &s_fabric[i];
        if (strcmp(node->type, "contact") == 0) {
            cJSON *contact = cJSON_CreateObject();
            cJSON_AddStringToObject(contact, "id", node->device_id);
            cJSON_AddStringToObject(contact, "name", node->name);
            cJSON_AddStringToObject(contact, "state", contact_is_open() ? "OPEN" : "CLOSED");
            cJSON_AddBoolToObject(contact, "stale", node->stale);
            if (contact_index == 0) {
                cJSON_AddBoolToObject(contact, "inverted", s_contact_invert);
            }
            cJSON_AddItemToArray(contacts, contact);
            contact_index++;
        } else if (strcmp(node->type, "motion") == 0) {
            cJSON *motion = cJSON_CreateObject();
            cJSON_AddStringToObject(motion, "id", node->device_id);
            cJSON_AddStringToObject(motion, "name", node->name);
            cJSON_AddStringToObject(motion, "state", s_motion_detected ? "DETECTED" : "CLEAR");
            cJSON_AddBoolToObject(motion, "stale", node->stale);
            double lux = s_motion_lux;
            if (metric_number(node->device_id, "lightLux", &lux) || s_has_motion_lux) {
                cJSON_AddNumberToObject(motion, "lux", lux);
            }
            cJSON_AddItemToArray(motions, motion);
            motion_index++;
        } else if (strcmp(node->type, "climate") == 0) {
            cJSON *climate = cJSON_CreateObject();
            cJSON_AddStringToObject(climate, "id", node->device_id);
            cJSON_AddStringToObject(climate, "name", node->name);
            cJSON_AddBoolToObject(climate, "stale", node->stale);
            double value = 0;
            if (metric_number(node->device_id, "temperature", &value)) {
                cJSON_AddNumberToObject(climate, "temperature", value);
            }
            if (metric_number(node->device_id, "humidity", &value)) {
                cJSON_AddNumberToObject(climate, "humidity", value);
            }
            if (metric_number(node->device_id, "co2", &value)) {
                cJSON_AddNumberToObject(climate, "co2", value);
            }
            if (metric_number(node->device_id, "pm25", &value)) {
                cJSON_AddNumberToObject(climate, "pm25", value);
            }
            if (metric_number(node->device_id, "airQuality", &value)) {
                cJSON_AddNumberToObject(climate, "airQuality", value);
            }
            cJSON_AddItemToArray(climates, climate);
        } else if (strcmp(node->type, "leak") == 0) {
            cJSON *leak = cJSON_CreateObject();
            cJSON_AddStringToObject(leak, "id", node->device_id);
            cJSON_AddStringToObject(leak, "name", node->name);
            cJSON_AddStringToObject(leak, "state", s_leak ? "LEAK" : "DRY");
            cJSON_AddBoolToObject(leak, "stale", node->stale);
            cJSON_AddItemToArray(leaks, leak);
            leak_index++;
        }
    }
    (void)motion_index;
    (void)leak_index;
    cJSON_AddArrayToObject(state, "buttons");
    cJSON_AddStringToObject(state, "scene", s_scene);
    cJSON_AddStringToObject(state, "firmware", "sns-alerts-1");
    cJSON_AddNumberToObject(
        state, "stateVersion", static_cast<double>(__atomic_add_fetch(&s_state_version, 1U, __ATOMIC_RELAXED)));
    if (s_commission_pending) {
        cJSON *commission = cJSON_AddObjectToObject(state, "commission");
        cJSON_AddStringToObject(commission, "event", s_commission_event);
        cJSON_AddNumberToObject(commission, "node", static_cast<double>(s_commission_node));
        if (s_commission_error[0] != '\0') {
            cJSON_AddStringToObject(commission, "error", s_commission_error);
        }
    }
    cJSON *diagnostics = cJSON_AddObjectToObject(state, "alpstugaDiagnostics");
    cJSON_AddNumberToObject(diagnostics, "attempts", s_alpstuga_attempts);
    cJSON_AddNumberToObject(diagnostics, "completed", s_alpstuga_completed);
    cJSON_AddNumberToObject(diagnostics, "attributes", s_alpstuga_attributes);
    snapshot_heap(state);
    cJSON_AddStringToObject(state, "updatedAt", timestamp);

    cJSON *readings = cJSON_AddArrayToObject(root, "readings");
    for (int i = 0; i < kMaxReadingDevices; ++i) {
        if (s_readings[i].device_id[0] == '\0' || s_readings[i].count <= 0) {
            continue;
        }
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "deviceId", s_readings[i].device_id);
        cJSON *metrics = cJSON_AddObjectToObject(item, "metrics");
        for (int j = 0; j < s_readings[i].count; ++j) {
            const HomehubMetric *metric = &s_readings[i].metrics[j];
            if (metric->is_bool) {
                cJSON_AddBoolToObject(metrics, metric->key, metric->flag);
            } else {
                cJSON_AddNumberToObject(metrics, metric->key, metric->number);
            }
        }
        cJSON_AddItemToArray(readings, item);
    }

    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return printed;
}

void homehub_aws_set_quiet(int quiet)
{
    s_quiet = quiet != 0;
    /* Keep MQTT connected so pair results can publish. */
}

int homehub_aws_publish_state(const char *json)
{
    if (s_quiet || !s_connected || s_client == nullptr) {
        return -1;
    }
    char *owned = nullptr;
    const char *payload = json;
    if (payload == nullptr) {
        owned = homehub_aws_build_state_json();
        payload = owned;
    }
    if (payload == nullptr) {
        return -1;
    }
    int msg_id = esp_mqtt_client_publish(s_client, s_state_topic, payload, 0, 1, 0);
    free(owned);
    if (msg_id < 0) {
        ESP_LOGW(TAG, "State publish failed");
        return -1;
    }
    ESP_LOGI(TAG, "Published state id=%d", msg_id);
    homehub_aws_notify_state_changed();
    return 0;
}

void homehub_aws_publish_commission(const char *event, uint64_t node_id, const char *error)
{
    if (event == nullptr || event[0] == '\0') {
        return;
    }
    snprintf(s_commission_event, sizeof(s_commission_event), "%s", event);
    s_commission_node = node_id;
    s_commission_error[0] = '\0';
    if (error != nullptr && error[0] != '\0') {
        snprintf(s_commission_error, sizeof(s_commission_error), "%s", error);
    }
    s_commission_pending = true;
    if (!s_connected || s_client == nullptr) {
        return;
    }
    char timestamp[32];
    now_iso(timestamp, sizeof(timestamp));
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "event", s_commission_event);
    cJSON_AddStringToObject(root, "gatewayId", HOMEHUB_DEVICE_ID);
    cJSON_AddNumberToObject(root, "node", static_cast<double>(s_commission_node));
    if (s_commission_error[0] != '\0') {
        cJSON_AddStringToObject(root, "error", s_commission_error);
    }
    cJSON_AddStringToObject(root, "recordedAt", timestamp);
    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (printed == nullptr) {
        return;
    }
    (void)esp_mqtt_client_publish(s_client, s_events_topic, printed, 0, 1, 0);
    free(printed);
    ESP_LOGI(TAG, "Published commission %s node %llu", s_commission_event,
             static_cast<unsigned long long>(s_commission_node));
}

static void publish_event(const char *event_name)
{
    if (!s_connected || s_client == nullptr) {
        return;
    }
    char timestamp[32];
    now_iso(timestamp, sizeof(timestamp));
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "event", event_name);
    cJSON_AddStringToObject(root, "gatewayId", HOMEHUB_DEVICE_ID);
    cJSON_AddStringToObject(root, "recordedAt", timestamp);
    char *printed = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (printed == nullptr) {
        return;
    }
    (void)esp_mqtt_client_publish(s_client, s_events_topic, printed, 0, 1, 0);
    free(printed);
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    auto *event = static_cast<esp_mqtt_event_handle_t>(event_data);
    switch (static_cast<esp_mqtt_event_id_t>(event_id)) {
    case MQTT_EVENT_CONNECTED:
        s_connected = true;
        ESP_LOGI(TAG, "MQTT connected to AWS IoT");
        homehub_ota_mark_valid();
        (void)esp_mqtt_client_subscribe(s_client, s_commands_topic, 1);
        (void)esp_mqtt_client_subscribe(s_client, s_ota_topic, 1);
        (void)esp_mqtt_client_subscribe(s_client, s_config_topic, 1);
        (void)esp_mqtt_client_subscribe(s_client, s_fabric_topic, 1);
        publish_event("online");
        (void)homehub_aws_publish_state(nullptr);
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false;
        ESP_LOGW(TAG, "MQTT disconnected");
        break;
    case MQTT_EVENT_DATA:
        if (event->data != nullptr && event->data_len > 0) {
            char *payload = static_cast<char *>(malloc(static_cast<size_t>(event->data_len) + 1));
            if (payload != nullptr) {
                memcpy(payload, event->data, static_cast<size_t>(event->data_len));
                payload[event->data_len] = '\0';
                const bool is_config = event->topic_len == static_cast<int>(strlen(s_config_topic)) &&
                    strncmp(event->topic, s_config_topic, static_cast<size_t>(event->topic_len)) == 0;
                const bool is_fabric = event->topic_len == static_cast<int>(strlen(s_fabric_topic)) &&
                    strncmp(event->topic, s_fabric_topic, static_cast<size_t>(event->topic_len)) == 0;
                if (is_fabric) {
                    homehub_aws_apply_fabric(payload);
                } else if (is_config && s_config_handler != nullptr) {
                    s_config_handler(payload);
                } else {
                    homehub_aws_on_command(payload);
                }
                free(payload);
            }
        }
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGW(TAG, "MQTT error");
        break;
    default:
        break;
    }
}

static void homehub_aws_task(void *arg)
{
    (void)arg;
    s_aws_task = xTaskGetCurrentTaskHandle();
#if !HOMEHUB_IOT_ENABLED
    ESP_LOGW(TAG, "AWS IoT disabled (no generated/iot_config.h)");
    vTaskDelete(nullptr);
    return;
#else
    snprintf(s_uri, sizeof(s_uri), "mqtts://%s:8883", HOMEHUB_IOT_ENDPOINT);
    snprintf(s_state_topic, sizeof(s_state_topic), "homehub/gateways/%s/state", HOMEHUB_DEVICE_ID);
    snprintf(s_events_topic, sizeof(s_events_topic), "homehub/gateways/%s/events", HOMEHUB_DEVICE_ID);
    snprintf(s_alerts_topic, sizeof(s_alerts_topic), "homehub/gateways/%s/alerts", HOMEHUB_DEVICE_ID);
    snprintf(s_commands_topic, sizeof(s_commands_topic), "homehub/gateways/%s/commands", HOMEHUB_DEVICE_ID);
    snprintf(s_ota_topic, sizeof(s_ota_topic), "homehub/gateways/%s/ota", HOMEHUB_DEVICE_ID);
    snprintf(s_config_topic, sizeof(s_config_topic), "homehub/gateways/%s/config", HOMEHUB_DEVICE_ID);
    snprintf(s_fabric_topic, sizeof(s_fabric_topic), "homehub/gateways/%s/fabric", HOMEHUB_DEVICE_ID);
    load_default_fabric();

    load_contact_invert();
    load_motion_lux();
    ESP_LOGI(TAG, "Waiting for Wi-Fi before AWS IoT");
    while (!wait_for_wifi()) {
        ESP_LOGW(TAG, "Wi-Fi not ready; retrying AWS IoT connect");
    }
    if (!wait_for_time()) {
        ESP_LOGW(TAG, "NTP not ready; TLS may fail until time syncs");
    }

    esp_mqtt_client_config_t mqtt_cfg = {};
    mqtt_cfg.broker.address.uri = s_uri;
    mqtt_cfg.broker.verification.certificate = HOMEHUB_AWS_ROOT_CA;
    mqtt_cfg.credentials.client_id = HOMEHUB_THING_NAME;
    mqtt_cfg.credentials.authentication.certificate = HOMEHUB_DEVICE_CERT;
    mqtt_cfg.credentials.authentication.key = HOMEHUB_DEVICE_KEY;
    mqtt_cfg.network.timeout_ms = 20000;
    mqtt_cfg.network.reconnect_timeout_ms = 10000;
    mqtt_cfg.buffer.size = 4096;
    mqtt_cfg.buffer.out_size = 4096;
    mqtt_cfg.task.stack_size = 6144;
    mqtt_cfg.task.priority = 5;

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (s_client == nullptr) {
        ESP_LOGE(TAG, "MQTT init failed");
        vTaskDelete(nullptr);
        return;
    }
    ESP_ERROR_CHECK(esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY, mqtt_event_handler, nullptr));
    ESP_LOGI(TAG, "Connecting MQTT as %s", HOMEHUB_THING_NAME);
    ESP_ERROR_CHECK(esp_mqtt_client_start(s_client));

    while (true) {
        const bool urgent = s_urgent_state_dirty;
        if (!urgent) {
            (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(kPublishIntervalMs));
        }
        if (s_urgent_state_dirty) {
            vTaskDelay(pdMS_TO_TICKS(kUrgentPublishDebounceMs));
            (void)ulTaskNotifyTake(pdTRUE, 0);
            s_urgent_state_dirty = false;
        }
        if (s_connected && !s_quiet && homehub_aws_publish_state(nullptr) != 0) {
            s_urgent_state_dirty = true;
        }
    }
#endif
}

int homehub_aws_start(void)
{
    if (s_started) {
        return 0;
    }
    s_started = true;
    load_contact_invert();
    load_motion_lux();
    if (xTaskCreate(homehub_aws_task, "homehub_aws", 6144, nullptr, 4, nullptr) != pdPASS) {
        s_started = false;
        ESP_LOGE(TAG, "Failed to start AWS IoT task");
        return -1;
    }
    return 0;
}

#else

int homehub_aws_start(void)
{
    return 0;
}

int homehub_aws_publish_state(const char *json)
{
    (void)json;
    return 0;
}

void homehub_aws_on_command(const char *json)
{
    (void)json;
}

char *homehub_aws_build_state_json(void)
{
    return strdup("{}");
}

void homehub_aws_notify_state_changed(void)
{
}

void homehub_aws_publish_state_soon(void)
{
}

void homehub_aws_set_light(const char *device_id, int on, int brightness)
{
    (void)device_id;
    (void)on;
    (void)brightness;
}

void homehub_aws_set_plug(const char *device_id, int on)
{
    (void)device_id;
    (void)on;
}

int homehub_aws_set_reachable(const char *device_id, int reachable)
{
    (void)device_id;
    (void)reachable;
    return 0;
}

int homehub_aws_expire_reachable(void)
{
    return 0;
}

int homehub_aws_mark_seen(const char *device_id)
{
    (void)device_id;
    return 0;
}

int homehub_aws_mark_stale(const char *device_id)
{
    (void)device_id;
    return 0;
}

int homehub_aws_is_reachable(const char *device_id)
{
    (void)device_id;
    return 1;
}

int homehub_aws_liveness_paused(void)
{
    return 0;
}

void homehub_aws_set_contact(int open)
{
    (void)open;
}

void homehub_aws_set_contact_invert(int invert)
{
    (void)invert;
}

int homehub_aws_contact_invert(void)
{
    return 0;
}

void homehub_aws_set_motion(int detected)
{
    (void)detected;
}

void homehub_aws_set_leak(int leak)
{
    (void)leak;
}

void homehub_history_add(const char *device_id, const char *kind, const char *value)
{
    (void)device_id;
    (void)kind;
    (void)value;
}

char *homehub_history_json(const char *device_id)
{
    (void)device_id;
    return nullptr;
}

void homehub_aws_set_metric(const char *device_id, const char *key, double value)
{
    (void)device_id;
    (void)key;
    (void)value;
}

void homehub_aws_set_metric_bool(const char *device_id, const char *key, int value)
{
    (void)device_id;
    (void)key;
    (void)value;
}

int homehub_aws_has_metric(const char *device_id, const char *key)
{
    (void)device_id;
    (void)key;
    return 0;
}

void homehub_aws_set_alpstuga_diagnostics(int attempts, int completed, int attributes)
{
    (void)attempts;
    (void)completed;
    (void)attributes;
}

void homehub_aws_set_command_handler(void (*handler)(const char *command))
{
    (void)handler;
}

void homehub_aws_set_pair_handler(void (*handler)(uint64_t node_id, const char *payload))
{
    (void)handler;
}

void homehub_aws_publish_commission(const char *event, uint64_t node_id, const char *error)
{
    (void)event;
    (void)node_id;
    (void)error;
}

void homehub_aws_set_state_handler(void (*handler)(void))
{
    (void)handler;
}

void homehub_aws_set_config_handler(void (*handler)(const char *json))
{
    (void)handler;
}

void homehub_aws_set_quiet(int quiet)
{
    (void)quiet;
}

void homehub_aws_apply_fabric(const char *json)
{
    (void)json;
}

int homehub_aws_fabric_count(void)
{
    return 0;
}

uint32_t homehub_aws_fabric_generation(void)
{
    return 0;
}

int homehub_aws_copy_fabric_node(int index, HomehubFabricNode *out)
{
    (void)index;
    (void)out;
    return -1;
}

const char *homehub_aws_device_id_for_node(uint64_t node_id)
{
    (void)node_id;
    return nullptr;
}

uint64_t homehub_aws_node_id_for_device(const char *device_id)
{
    (void)device_id;
    return 0;
}

const char *homehub_aws_device_type(const char *device_id)
{
    (void)device_id;
    return nullptr;
}

#endif
