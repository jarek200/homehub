#include "homehub_s3_put.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_http_client.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#include <time.h>

#if __has_include("generated/iot_config.h")
#include "generated/iot_config.h"
#elif __has_include("iot_config.h")
#include "iot_config.h"
#endif

namespace {

String lastError;
String accessKey;
String secretKey;
String sessionToken;
time_t credentialsExpireAt = 0;

#if defined(HOMEHUB_IOT_ENABLED) && defined(HOMEHUB_SNAPSHOT_BUCKET)

String toHex(const uint8_t* data, size_t length) {
  static const char* kHex = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    out += kHex[(data[i] >> 4) & 0x0f];
    out += kHex[data[i] & 0x0f];
  }
  return out;
}

void sha256(const uint8_t* data, size_t length, uint8_t out[32]) {
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, data, length);
  mbedtls_sha256_finish(&ctx, out);
  mbedtls_sha256_free(&ctx);
}

void hmacSha256(const uint8_t* key, size_t keyLen, const uint8_t* data, size_t dataLen,
                uint8_t out[32]) {
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(info, key, keyLen, data, dataLen, out);
}

String sha256Hex(const uint8_t* data, size_t length) {
  uint8_t hash[32];
  sha256(data, length, hash);
  return toHex(hash, 32);
}

String uriEncode(const String& value, bool encodeSlash) {
  String out;
  out.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
        c == '_' || c == '.' || c == '~' || (c == '/' && !encodeSlash)) {
      out += c;
    } else {
      char buf[4];
      snprintf(buf, sizeof(buf), "%%%02X", static_cast<unsigned char>(c));
      out += buf;
    }
  }
  return out;
}

esp_err_t collectHttpBody(esp_http_client_event_t* evt) {
  if (evt->event_id == HTTP_EVENT_ON_DATA && evt->user_data && evt->data && evt->data_len > 0) {
    auto* body = static_cast<String*>(evt->user_data);
    body->concat(static_cast<const char*>(evt->data), evt->data_len);
    if (body->length() > 8192) {
      body->remove(8192);
    }
  }
  return ESP_OK;
}

bool fetchCredentials() {
  if (WiFi.status() != WL_CONNECTED) {
    lastError = "wifi";
    return false;
  }
  const time_t now = time(nullptr);
  if (accessKey.length() > 0 && credentialsExpireAt > now + 300) {
    return true;
  }

  const String url = String("https://") + HOMEHUB_IOT_CREDENTIALS_ENDPOINT + "/role-aliases/" +
                     HOMEHUB_IOT_ROLE_ALIAS + "/credentials";
  String body;
  esp_http_client_config_t config = {};
  config.url = url.c_str();
  config.cert_pem = HOMEHUB_AWS_ROOT_CA;
  config.client_cert_pem = HOMEHUB_DEVICE_CERT;
  config.client_key_pem = HOMEHUB_DEVICE_KEY;
  config.timeout_ms = 15000;
  config.keep_alive_enable = false;
  config.buffer_size = 4096;
  config.buffer_size_tx = 2048;
  config.event_handler = collectHttpBody;
  config.user_data = &body;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) {
    lastError = "creds-client";
    return false;
  }
  esp_http_client_set_header(client, "x-amzn-iot-thingname", HOMEHUB_THING_NAME);
  const esp_err_t result = esp_http_client_perform(client);
  const int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (result != ESP_OK || status != 200) {
    lastError = String("creds-http-") + status;
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    lastError = "creds-json";
    return false;
  }
  JsonVariant creds = doc["credentials"];
  const char* nextAccess = creds["accessKeyId"];
  const char* nextSecret = creds["secretAccessKey"];
  const char* nextToken = creds["sessionToken"];
  const char* expiration = creds["expiration"];
  if (!nextAccess || !nextSecret || !nextToken) {
    lastError = "creds-missing";
    return false;
  }
  accessKey = nextAccess;
  secretKey = nextSecret;
  sessionToken = nextToken;
  credentialsExpireAt = now + 3300;
  (void)expiration;
  lastError = "";
  return true;
}

String signingKeyHexDate(const String& dateStamp, const String& stringToSign, uint8_t signature[32]) {
  const String kSecret = String("AWS4") + secretKey;
  uint8_t kDate[32];
  uint8_t kRegion[32];
  uint8_t kService[32];
  uint8_t kSigning[32];
  hmacSha256(reinterpret_cast<const uint8_t*>(kSecret.c_str()), kSecret.length(),
             reinterpret_cast<const uint8_t*>(dateStamp.c_str()), dateStamp.length(), kDate);
  hmacSha256(kDate, 32, reinterpret_cast<const uint8_t*>(HOMEHUB_AWS_REGION),
             strlen(HOMEHUB_AWS_REGION), kRegion);
  hmacSha256(kRegion, 32, reinterpret_cast<const uint8_t*>("s3"), 2, kService);
  hmacSha256(kService, 32, reinterpret_cast<const uint8_t*>("aws4_request"), 12, kSigning);
  hmacSha256(kSigning, 32, reinterpret_cast<const uint8_t*>(stringToSign.c_str()),
             stringToSign.length(), signature);
  return toHex(signature, 32);
}

#endif

}  // namespace

bool homehubS3Configured() {
#if defined(HOMEHUB_IOT_ENABLED) && defined(HOMEHUB_SNAPSHOT_BUCKET)
  return true;
#else
  return false;
#endif
}

String homehubS3LastError() { return lastError; }

bool homehubS3PrimeCredentials() {
#if defined(HOMEHUB_IOT_ENABLED) && defined(HOMEHUB_SNAPSHOT_BUCKET)
  return fetchCredentials();
#else
  return false;
#endif
}

bool homehubS3PutJpeg(const uint8_t* data, size_t length, const String& objectKey, String& error) {
#if defined(HOMEHUB_IOT_ENABLED) && defined(HOMEHUB_SNAPSHOT_BUCKET)
  if (!data || length == 0) {
    error = lastError = "empty-jpeg";
    return false;
  }
  if (!fetchCredentials()) {
    error = lastError;
    return false;
  }

  time_t now = time(nullptr);
  struct tm utc {};
  gmtime_r(&now, &utc);
  char amzDate[20];
  char dateStamp[9];
  strftime(amzDate, sizeof(amzDate), "%Y%m%dT%H%M%SZ", &utc);
  strftime(dateStamp, sizeof(dateStamp), "%Y%m%d", &utc);

  const String host = String(HOMEHUB_SNAPSHOT_BUCKET) + ".s3." + HOMEHUB_AWS_REGION +
                      ".amazonaws.com";
  const String canonicalUri = String("/") + uriEncode(objectKey, false);
  const String payloadHash = sha256Hex(data, length);
  String canonicalHeaders = "content-type:image/jpeg\nhost:";
  canonicalHeaders += host;
  canonicalHeaders += "\nx-amz-content-sha256:";
  canonicalHeaders += payloadHash;
  canonicalHeaders += "\nx-amz-date:";
  canonicalHeaders += amzDate;
  canonicalHeaders += "\nx-amz-security-token:";
  canonicalHeaders += sessionToken;
  canonicalHeaders += "\n";
  const String signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  String canonicalRequest = "PUT\n";
  canonicalRequest += canonicalUri;
  canonicalRequest += "\n\n";
  canonicalRequest += canonicalHeaders;
  canonicalRequest += "\n";
  canonicalRequest += signedHeaders;
  canonicalRequest += "\n";
  canonicalRequest += payloadHash;

  const String canonicalHash = sha256Hex(reinterpret_cast<const uint8_t*>(canonicalRequest.c_str()),
                                         canonicalRequest.length());
  String stringToSign = "AWS4-HMAC-SHA256\n";
  stringToSign += amzDate;
  stringToSign += "\n";
  stringToSign += dateStamp;
  stringToSign += "/";
  stringToSign += HOMEHUB_AWS_REGION;
  stringToSign += "/s3/aws4_request\n";
  stringToSign += canonicalHash;

  uint8_t signature[32];
  const String signatureHex = signingKeyHexDate(dateStamp, stringToSign, signature);
  String authorization = "AWS4-HMAC-SHA256 Credential=";
  authorization += accessKey;
  authorization += "/";
  authorization += dateStamp;
  authorization += "/";
  authorization += HOMEHUB_AWS_REGION;
  authorization += "/s3/aws4_request, SignedHeaders=";
  authorization += signedHeaders;
  authorization += ", Signature=";
  authorization += signatureHex;

  const String url = String("https://") + host + canonicalUri;
  esp_http_client_config_t config = {};
  config.url = url.c_str();
  config.cert_pem = HOMEHUB_AWS_ROOT_CA;
  config.timeout_ms = 20000;
  config.keep_alive_enable = false;
  config.buffer_size = 4096;
  config.buffer_size_tx = 4096;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) {
    error = lastError = "s3-client";
    return false;
  }
  esp_http_client_set_method(client, HTTP_METHOD_PUT);
  esp_http_client_set_header(client, "Content-Type", "image/jpeg");
  esp_http_client_set_header(client, "x-amz-content-sha256", payloadHash.c_str());
  esp_http_client_set_header(client, "x-amz-date", amzDate);
  esp_http_client_set_header(client, "x-amz-security-token", sessionToken.c_str());
  esp_http_client_set_header(client, "Authorization", authorization.c_str());
  esp_http_client_set_post_field(client, reinterpret_cast<const char*>(data), length);
  const esp_err_t result = esp_http_client_perform(client);
  const int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (result != ESP_OK || (status != 200 && status != 204)) {
    error = lastError = String("s3-http-") + status + "-" + esp_err_to_name(result);
    return false;
  }
  lastError = "";
  error = "";
  return true;
#else
  (void)data;
  (void)length;
  (void)objectKey;
  error = lastError = "s3-disabled";
  return false;
#endif
}
