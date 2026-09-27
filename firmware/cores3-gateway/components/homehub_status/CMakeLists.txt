idf_component_register(
    SRCS "homehub_status.cpp"
    INCLUDE_DIRS "include"
    REQUIRES homehub_aws esp_http_server json nvs_flash
    PRIV_REQUIRES esp_netif heap
)

set_property(TARGET ${COMPONENT_LIB} PROPERTY CXX_STANDARD 17)
