# PAA roots for the Matter commissioner

Copy these `.der` files into `~/esp/esp-matter/examples/controller/paa_cert/` and enable `CONFIG_SPIFFS_ATTESTATION_TRUST_STORE`. The OTBR partition table must include a SPIFFS slot named **`paa_cert`**. Mount that label — `rcp_fw` is also SPIFFS.

| File | Use |
|---|---|
| `ikea_paa_g1.der` | IKEA production VID `0x117C` (required for KAJPLATS) |
| `ikea_paa_test.der` | IKEA test PAA |
| `digicert_matter_paa.der` | DigiCert Matter PKI G1 |
| `Chip-Test-*.der`, `DCL-ESP-Cert.der` | Dev / Espressif only |

Without the IKEA G1 root, commissioning fails at attestation (`kPaaNotFound`, err 101). Adding another vendor: see [COMMISSIONING.md](../COMMISSIONING.md#other-vendors).
