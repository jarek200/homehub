#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HOMEHUB_FABRIC_MAX 16
#define HOMEHUB_FABRIC_READS 6

typedef struct {
    uint64_t node_id;
    char device_id[20];
    char name[24];
    char type[16];
    uint16_t endpoints[HOMEHUB_FABRIC_READS];
    uint32_t clusters[HOMEHUB_FABRIC_READS];
    uint32_t attributes[HOMEHUB_FABRIC_READS];
    int64_t last_seen_us;
    uint8_t count;
    bool stale;
} HomehubFabricNode;

/* MQTT/TLS to AWS IoT Core. Pair is the only Matter command on this path; never log the code. */

int homehub_aws_start(void);
int homehub_aws_publish_state(const char *json);
char *homehub_aws_build_state_json(void);
void homehub_aws_notify_state_changed(void);
void homehub_aws_publish_state_soon(void);
void homehub_aws_on_command(const char *json);
void homehub_aws_set_light(const char *device_id, int on, int brightness);
void homehub_aws_set_plug(const char *device_id, int on);
int homehub_aws_set_reachable(const char *device_id, int reachable);
int homehub_aws_expire_reachable(void);
int homehub_aws_mark_seen(const char *device_id);
int homehub_aws_mark_stale(const char *device_id);
int homehub_aws_is_reachable(const char *device_id);
int homehub_aws_liveness_paused(void);
void homehub_aws_set_contact(int open);
void homehub_aws_set_contact_invert(int invert);
int homehub_aws_contact_invert(void);
void homehub_aws_set_motion(int detected);
void homehub_aws_set_leak(int leak);
void homehub_history_add(const char *device_id, const char *kind, const char *value);
char *homehub_history_json(const char *device_id);
void homehub_aws_set_metric(const char *device_id, const char *key, double value);
void homehub_aws_set_metric_bool(const char *device_id, const char *key, int value);
int homehub_aws_has_metric(const char *device_id, const char *key);
void homehub_aws_set_alpstuga_diagnostics(int attempts, int completed, int attributes);
void homehub_aws_set_command_handler(void (*handler)(const char *command));
void homehub_aws_set_pair_handler(void (*handler)(uint64_t node_id, const char *payload));
void homehub_aws_set_state_handler(void (*handler)(void));
void homehub_aws_set_config_handler(void (*handler)(const char *json));
void homehub_aws_set_quiet(int quiet);
void homehub_aws_publish_commission(const char *event, uint64_t node_id, const char *error);
void homehub_aws_apply_fabric(const char *json);
int homehub_aws_fabric_count(void);
uint32_t homehub_aws_fabric_generation(void);
int homehub_aws_copy_fabric_node(int index, HomehubFabricNode *out);
const char *homehub_aws_device_id_for_node(uint64_t node_id);
uint64_t homehub_aws_node_id_for_device(const char *device_id);
const char *homehub_aws_device_type(const char *device_id);

#ifdef __cplusplus
}
#endif
