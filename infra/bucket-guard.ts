/// <reference path="../.sst/platform/config.d.ts" />

import * as aws from '@pulumi/aws';

/** Deny non-TLS access. Same statement as the snapshot bucket. */
export function denyInsecureTransport(resourceName: string, bucket: aws.s3.Bucket) {
  return new aws.s3.BucketPolicy(resourceName, {
    bucket: bucket.id,
    policy: bucket.arn.apply((bucketArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Principal: '*',
            Action: 's3:*',
            Resource: [bucketArn, `${bucketArn}/*`],
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          },
        ],
      })
    ),
  });
}

export function abortIncompleteUploads(resourceName: string, bucket: aws.s3.Bucket) {
  return new aws.s3.BucketLifecycleConfiguration(resourceName, {
    bucket: bucket.id,
    rules: [
      {
        id: 'abort-incomplete-uploads',
        status: 'Enabled',
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        filter: {},
      },
    ],
  });
}
