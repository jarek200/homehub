/// <reference path="../.sst/platform/config.d.ts" />

/** Verified SES domain. Unset skips the SES identity so deploys work without a custom domain. */
export function appDomain(): string | undefined {
  const domain = process.env.APP_DOMAIN?.trim().toLowerCase();
  return domain || undefined;
}

export function sesFromAddress(domain: string): string {
  return `HomeHub <noreply@${domain}>`;
}

function createDnsProvider() {
  const accessKey = process.env.DNS_AWS_ACCESS_KEY_ID?.trim();
  const secretKey = process.env.DNS_AWS_SECRET_ACCESS_KEY?.trim();
  const token = process.env.DNS_AWS_SESSION_TOKEN?.trim();
  if (!accessKey || !secretKey || !token) return undefined;
  return new aws.Provider('AppsSesDnsProvider', {
    region: 'us-east-1',
    accessKey,
    secretKey,
    token,
  });
}

export function createEmail() {
  const domain = appDomain();
  if (!domain) return undefined;

  const identity = new aws.ses.DomainIdentity('AppsEmailIdentity', {
    domain,
  });
  const dkim = new aws.ses.DomainDkim('AppsEmailDkim', {
    domain: identity.domain,
  });

  const hostedZoneId = process.env.APPS_HOSTED_ZONE_ID?.trim();
  const dnsProvider = createDnsProvider();
  if (hostedZoneId && dnsProvider) {
    new aws.route53.Record(
      'AppsSesVerification',
      {
        zoneId: hostedZoneId,
        name: identity.id.apply((id) => `_amazonses.${id}`),
        type: 'TXT',
        ttl: 600,
        records: [identity.verificationToken],
        allowOverwrite: true,
      },
      { provider: dnsProvider }
    );

    for (const index of [0, 1, 2] as const) {
      new aws.route53.Record(
        `AppsSesDkim${index}`,
        {
          zoneId: hostedZoneId,
          name: dkim.dkimTokens.apply((tokens) => `${tokens[index]}._domainkey.${domain}`),
          type: 'CNAME',
          ttl: 600,
          records: [dkim.dkimTokens.apply((tokens) => `${tokens[index]}.dkim.amazonses.com`)],
          allowOverwrite: true,
        },
        { provider: dnsProvider }
      );
    }
  }

  return {
    fromAddress: sesFromAddress(domain),
    identity,
    dkim,
  };
}
