import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './schema.graphql',
  generates: {
    './generated/index.ts': {
      plugins: ['typescript'],
      config: {
        // Generate types for all GraphQL types
        enumsAsTypes: true,
        // Use const for enums
        constEnums: true,
        // Generate input types
        inputMaybeValue: 'T | null | undefined',
        // Use exact types for better type safety
        skipTypename: false,
        // Export everything
        exportFragmentSpreadSubTypes: true,
        // Use Scalars for ID, DateTime, etc.
        scalars: {
          ID: 'string',
          String: 'string',
          Int: 'number',
          Float: 'number',
          Boolean: 'boolean',
          AWSDateTime: 'string',
          AWSDate: 'string',
          AWSTime: 'string',
          AWSTimestamp: 'number',
          AWSEmail: 'string',
          AWSJSON: 'string',
          AWSURL: 'string',
          AWSPhone: 'string',
          AWSIPAddress: 'string',
        },
      },
    },
  },
};

export default config;
