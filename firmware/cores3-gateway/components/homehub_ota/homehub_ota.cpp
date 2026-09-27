#include "homehub_ota.h"

#include <esp_crt_bundle.h>
#include <esp_https_ota.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_ota_ops.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "homehub_ota";
static constexpr size_t kMaxUrl = 1536;
static constexpr int kOtaTaskStack = 12288;

static char *s_url;
static volatile bool s_running;

static bool url_allowed(const char *url)
{
    if (url == nullptr || strncmp(url, "https://", 8) != 0) {
        return false;
    }
    const char *host = url + 8;
    const size_t host_len = strcspn(host, "/:?");
    constexpr char kSuffix[] = "amazonaws.com";
    constexpr size_t kSuffixLen = sizeof(kSuffix) - 1;
    if (host_len < kSuffixLen) {
        return false;
    }
    const size_t offset = host_len - kSuffixLen;
    if (strncmp(host + offset, kSuffix, kSuffixLen) != 0) {
        return false;
    }
    return offset == 0 || host[offset - 1] == '.';
}

static void ota_task(void *arg)
{
    (void)arg;
    esp_http_client_config_t http = {};
    http.url = s_url;
    http.crt_bundle_attach = esp_crt_bundle_attach;
    http.timeout_ms = 60000;
    http.keep_alive_enable = true;
    http.buffer_size = 2048;
    http.buffer_size_tx = 1024;

    esp_https_ota_config_t ota = {};
    ota.http_config = &http;
    ota.partial_http_download = false;

    ESP_LOGI(TAG, "Starting HTTPS OTA");
    const esp_err_t err = esp_https_ota(&ota);
    free(s_url);
    s_url = nullptr;
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA written; rebooting");
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
    }
    ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    s_running = false;
    vTaskDelete(nullptr);
}

int homehub_ota_request(const char *url)
{
    if (!url_allowed(url)) {
        ESP_LOGW(TAG, "Rejected OTA url");
        return -1;
    }
    if (s_running) {
        ESP_LOGW(TAG, "OTA already running");
        return -1;
    }
    const size_t n = strnlen(url, kMaxUrl + 1);
    if (n == 0 || n > kMaxUrl) {
        ESP_LOGW(TAG, "OTA url length invalid");
        return -1;
    }
    char *copy = static_cast<char *>(malloc(n + 1));
    if (copy == nullptr) {
        ESP_LOGE(TAG, "OTA url alloc failed");
        return -1;
    }
    memcpy(copy, url, n);
    copy[n] = '\0';
    s_url = copy;
    s_running = true;
    if (xTaskCreate(ota_task, "homehub_ota", kOtaTaskStack, nullptr, 5, nullptr) != pdPASS) {
        s_running = false;
        free(s_url);
        s_url = nullptr;
        ESP_LOGE(TAG, "Failed to start OTA task");
        return -1;
    }
    return 0;
}

int homehub_ota_busy(void)
{
    return s_running ? 1 : 0;
}

void homehub_ota_mark_valid(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (running == nullptr) {
        return;
    }
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    if (esp_ota_get_state_partition(running, &state) != ESP_OK) {
        return;
    }
    if (state != ESP_OTA_IMG_PENDING_VERIFY) {
        return;
    }
    if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) {
        ESP_LOGI(TAG, "OTA slot confirmed");
    } else {
        ESP_LOGW(TAG, "OTA confirm failed");
    }
}
