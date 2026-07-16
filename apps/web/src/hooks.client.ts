// Client-side hooks
export const handleError = ({ error }) => {
  console.error('Client error:', error);
  return {
    message: 'An unexpected error occurred',
  };
};
