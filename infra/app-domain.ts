/// <reference path="../.sst/platform/config.d.ts" />

import { type ComponentResourceOptions, output } from '@pulumi/pulumi';

const LOCAL_WEB_ORIGINS = ['http://localhost:3000/', 'http://127.0.0.1:3000/'];

type DnsAliasRecord = {
  name: $util.Input<string>;
  aliasName: $util.Input<string>;
  aliasZone: $util.Input<string>;
};

type DnsValueRecord = {
  name: $util.Input<string>;
  type: $util.Input<string>;
  value: $util.Input<string>;
};

function resourceSuffix(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

function normalizeAppOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

/**
 * Custom DNS adapter for cross-account Route 53 records.
 *
 * SST's built-in `sst.aws.dns()` calls `route53.getZone()` internally,
 * which always runs with the default AWS provider (workload account) and
 * cannot see the management account's zone. This adapter bypasses that
 * lookup and creates Route 53 records directly using explicit credentials
 * pre-assumed in the CI workflow via `aws sts assume-role`.
 *
 * The provider must use `accessKey`/`secretKey`/`token` directly rather than
 * `assumeRoles` -- the Pulumi AWS provider's `assumeRoles` option does not
 * propagate to internal reads (e.g. GetHostedZone) performed by the provider.
 */
function createCrossAccountRoute53Dns(hostedZoneId: string) {
  const accessKey = process.env.DNS_AWS_ACCESS_KEY_ID?.trim();
  const secretKey = process.env.DNS_AWS_SECRET_ACCESS_KEY?.trim();
  const token = process.env.DNS_AWS_SESSION_TOKEN?.trim();

  if (!accessKey || !secretKey || !token) {
    return sst.aws.dns({ zone: hostedZoneId });
  }

  const dnsProvider = new aws.Provider('AppsDnsProvider', {
    region: 'us-east-1',
    accessKey,
    secretKey,
    token,
  });

  return {
    provider: 'aws' as const,
    createAlias(namePrefix: string, record: DnsAliasRecord, opts: ComponentResourceOptions) {
      const suffix = resourceSuffix(String(record.name));

      return ['A', 'AAAA'].map((type) =>
        output(
          new aws.route53.Record(
            `${namePrefix}${type}Record${suffix}`,
            {
              zoneId: hostedZoneId,
              name: record.name,
              type,
              aliases: [
                {
                  name: record.aliasName,
                  zoneId: record.aliasZone,
                  evaluateTargetHealth: true,
                },
              ],
              allowOverwrite: true,
            },
            // Drop `parent` so we don't inherit the default AWS provider from the component
            { dependsOn: opts.dependsOn, provider: dnsProvider }
          )
        )
      );
    },
    createRecord(namePrefix: string, record: DnsValueRecord, opts: ComponentResourceOptions) {
      const suffix = resourceSuffix(`${record.type}${String(record.name)}`);

      return output(
        new aws.route53.Record(
          `${namePrefix}Record${suffix}`,
          {
            zoneId: hostedZoneId,
            name: record.name,
            type: record.type,
            ttl: 60,
            records: [record.value],
            allowOverwrite: true,
          },
          // Drop `parent` so we don't inherit the default AWS provider from the component
          { dependsOn: opts.dependsOn, provider: dnsProvider }
        )
      );
    },
    createCaa() {
      return undefined;
    },
  };
}

/**
 * Creates an ACM certificate in the workload account (us-east-1, required by CloudFront)
 * and validates it via a DNS record in the management account's Route 53 zone.
 *
 * The DNS credentials must be pre-assumed in the CI workflow before calling this.
 * Returns the validated certificate ARN, or undefined if credentials are not available.
 */
export function createAppCert(hostname: string, hostedZoneId: string) {
  const accessKey = process.env.DNS_AWS_ACCESS_KEY_ID?.trim();
  const secretKey = process.env.DNS_AWS_SECRET_ACCESS_KEY?.trim();
  const token = process.env.DNS_AWS_SESSION_TOKEN?.trim();

  if (!accessKey || !secretKey || !token) {
    return undefined;
  }

  const dnsProvider = new aws.Provider('AppsDnsCertProvider', {
    region: 'us-east-1',
    accessKey,
    secretKey,
    token,
  });

  // Workload account provider — explicitly us-east-1 since ACM must match CloudFront's region.
  // In CI the default env vars (from OIDC) are used; no profile is set.
  const usEast1Provider = new aws.Provider('UsEast1Provider', {
    region: 'us-east-1',
  });

  // ACM cert in the workload account us-east-1 (must be same account as CloudFront)
  const cert = new aws.acm.Certificate(
    'AppCert',
    { domainName: hostname, validationMethod: 'DNS' },
    { provider: usEast1Provider }
  );

  // DNS validation record in the management account's Route 53 zone.
  // CRITICAL: created at top-level scope (NOT inside .apply()) so that
  // the explicit `provider: dnsProvider` is respected by Pulumi.
  const validationRecord = new aws.route53.Record(
    'AppCertValidationRecord',
    {
      zoneId: hostedZoneId,
      name: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordName),
      type: cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordType),
      records: [cert.domainValidationOptions.apply((opts) => opts[0].resourceRecordValue)],
      ttl: 60,
    },
    { provider: dnsProvider }
  );

  // Wait for ACM validation (workload account watches its own cert)
  const validation = new aws.acm.CertificateValidation(
    'AppCertValidation',
    {
      certificateArn: cert.arn,
      validationRecordFqdns: [validationRecord.fqdn],
    },
    { provider: usEast1Provider }
  );

  return validation.certificateArn;
}

export function getWebAppUrl(): string | undefined {
  return normalizeAppOrigin(process.env.APP_URL);
}

export function getWebCallbackUrls(): string[] {
  const appUrl = getWebAppUrl();
  return appUrl ? [`${appUrl}/`, ...LOCAL_WEB_ORIGINS] : LOCAL_WEB_ORIGINS;
}

export function getWebDomainConfig() {
  const appUrl = getWebAppUrl();
  if (!appUrl) return undefined;

  const name = new URL(appUrl).hostname;
  const hostedZoneId = process.env.APPS_HOSTED_ZONE_ID?.trim();

  if (!hostedZoneId) {
    return { name };
  }

  const certArn = createAppCert(name, hostedZoneId);

  return {
    name,
    dns: createCrossAccountRoute53Dns(hostedZoneId),
    ...(certArn ? { cert: certArn } : {}),
  };
}
