export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new HttpError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, 'AUTHENTICATION_REQUIRED', message);
  }
  static forbidden(message = 'Insufficient permissions') {
    return new HttpError(403, 'FORBIDDEN', message);
  }
  static notFound(code: string, message: string) {
    return new HttpError(404, code, message);
  }
  static conflict(code: string, message: string) {
    return new HttpError(409, code, message);
  }
}