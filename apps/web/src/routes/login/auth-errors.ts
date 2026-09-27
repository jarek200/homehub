type CognitoError = { name?: string; message?: string };

export function cognitoAuthError(
  err: unknown,
  isLogin: boolean
): { message: string; goToSignIn: boolean } {
  const authError = err as CognitoError;

  if (authError.name === 'NotAuthorizedException') {
    if (authError.message?.includes('CONFIRMED')) {
      return { message: 'Account already confirmed. Please sign in.', goToSignIn: true };
    }
    return { message: 'Incorrect email or password', goToSignIn: false };
  }
  if (authError.name === 'UserNotFoundException') {
    return { message: 'User not found', goToSignIn: false };
  }
  if (authError.name === 'UsernameExistsException' || authError.name === 'AliasExistsException') {
    return {
      message: 'An account with this email already exists. Please sign in instead.',
      goToSignIn: true,
    };
  }
  if (authError.name === 'InvalidPasswordException') {
    return { message: 'Password does not meet requirements', goToSignIn: false };
  }
  if (authError.name === 'CodeMismatchException') {
    return { message: 'Invalid verification code', goToSignIn: false };
  }
  return {
    message: authError.message || (isLogin ? 'Login failed' : 'Signup failed'),
    goToSignIn: false,
  };
}
