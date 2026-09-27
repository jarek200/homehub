/// <reference path="../.sst/platform/config.d.ts" />

import { getWebCallbackUrls } from './app-domain';

export function createAuth(
  createUserProfileFunction: ReturnType<typeof import('./functions').createUserProfile>
) {
  // Cognito User Pool with post-confirmation trigger
  const auth = new sst.aws.CognitoUserPool('Auth', {
    usernames: ['email'],
    transform: {
      userPool: (args) => {
        args.lambdaConfig = {
          postConfirmation: createUserProfileFunction.arn,
        };
      },
    },
  });

  // Grant Cognito permission to invoke the Lambda
  new aws.lambda.Permission('CreateUserProfilePermission', {
    action: 'lambda:InvokeFunction',
    function: createUserProfileFunction.arn,
    principal: 'cognito-idp.amazonaws.com',
    sourceArn: auth.arn,
  });

  // Add a client to the user pool
  const callbackUrls = getWebCallbackUrls();
  const authClient = auth.addClient('AuthClient', {
    callbackUrls,
    transform: {
      client: {
        logoutUrls: callbackUrls,
      },
    },
  });

  return { auth, authClient };
}
