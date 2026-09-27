idf_component_register(
    SRCS "homehub_ota.cpp"
    INCLUDE_DIRS "include"
    REQUIRES app_update esp_https_ota
    PRIV_REQUIRES mbedtls
)
