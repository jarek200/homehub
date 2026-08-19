#ifndef SENSIRION_ARCH_CONFIG_H
#define SENSIRION_ARCH_CONFIG_H

#include <stdlib.h>
#include <stdint.h>

#ifndef __cplusplus
#if __STDC_VERSION__ >= 199901L
#include <stdbool.h>
#else
#ifndef bool
#define bool int
#define true 1
#define false 0
#endif
#endif
#endif

#define SENSIRION_I2C_CLOCK_PERIOD_USEC 10

#endif /* SENSIRION_ARCH_CONFIG_H */
