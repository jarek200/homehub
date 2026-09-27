#pragma once

#include <stddef.h>
#include <stdint.h>
#include <WString.h>

bool homehubS3Configured();
bool homehubS3PrimeCredentials();
bool homehubS3PutJpeg(const uint8_t* data, size_t length, const String& objectKey, String& error);
String homehubS3LastError();
