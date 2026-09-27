idf_component_register(
    SRCS "homehub_aws.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "."
    REQUIRES mqtt json homehub_ota
    PRIV_REQUIRES esp_netif lwip esp_event nvs_flash heap
)
