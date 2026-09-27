type CognitoError = { name?: string; message?: string };

export function cognitoAuthError(err: unknown): string {
  const authError = err as CognitoError;

  if (authError.name === 'NotAuthorizedException') {
    return 'Incorrect email or password';
  }
  if (authError.name === 'UserNotFoundException') {
    return 'User not found';
  }
  if (authError.name === 'InvalidPasswordException') {
    return 'Password does not meet requirements';
  }
  if (authError.name === 'CodeMismatchException') {
    return 'Incorrect authenticator code';
  }
  return authError.message || 'Login failed';
}
