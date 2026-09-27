#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*homehub_status_command_handler_t)(const char *command);

int homehub_status_start(homehub_status_command_handler_t command_handler);
void homehub_status_notify(void);
void homehub_status_apply_config(const char *json);

#ifdef __cplusplus
}
#endif
