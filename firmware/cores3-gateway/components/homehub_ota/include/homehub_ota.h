#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/* HTTPS app OTA from a short-lived S3 URL. First image still needs USB. */

int homehub_ota_request(const char *url);
void homehub_ota_mark_valid(void);
int homehub_ota_busy(void);

#ifdef __cplusplus
}
#endif
