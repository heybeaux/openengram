export class EngramError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'EngramError';
  }
}

export class AuthError extends EngramError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class NotFoundError extends EngramError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends EngramError {
  constructor(message = 'Request timed out') {
    super(message, 0, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}
