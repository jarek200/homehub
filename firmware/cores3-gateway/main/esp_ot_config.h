#pragma once

#include "driver/gpio.h"
#include "esp_openthread_types.h"

/* M5Stack CoreS3 Thread BR (K149) Module Gateway H2 UART. */
#define HOMEHUB_OT_RCP_RX_PIN GPIO_NUM_10
#define HOMEHUB_OT_RCP_TX_PIN GPIO_NUM_17

static inline esp_openthread_platform_config_t homehub_ot_config(void)
{
    esp_openthread_platform_config_t config = {
        .radio_config = {
            .radio_mode = RADIO_MODE_UART_RCP,
            .radio_uart_config = {
                .port = UART_NUM_1,
                .uart_config = {
                    .baud_rate = 460800,
                    .data_bits = UART_DATA_8_BITS,
                    .parity = UART_PARITY_DISABLE,
                    .stop_bits = UART_STOP_BITS_1,
                    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
                    .rx_flow_ctrl_thresh = 0,
                    .source_clk = UART_SCLK_DEFAULT,
                },
                .rx_pin = HOMEHUB_OT_RCP_RX_PIN,
                .tx_pin = HOMEHUB_OT_RCP_TX_PIN,
            },
        },
        .host_config = {
            .host_connection_mode = HOST_CONNECTION_MODE_NONE,
        },
        .port_config = {
            .storage_partition_name = "nvs",
            .netif_queue_size = 10,
            .task_queue_size = 10,
        },
    };
    return config;
}
