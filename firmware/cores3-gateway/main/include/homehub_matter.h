#pragma once

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

/* Local Matter reads/commands. Results are published through homehub_aws. */

void homehub_matter_start(void);
void homehub_matter_apply_command(const char *command);
void homehub_matter_pair(uint64_t node_id, const char *payload);
void homehub_matter_set_quiet(int quiet);
int homehub_matter_quiet(void);

#ifdef __cplusplus
}
#endif
