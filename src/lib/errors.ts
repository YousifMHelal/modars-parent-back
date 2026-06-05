export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(400, ErrorCode.VALIDATION_ERROR, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, ErrorCode.NOT_FOUND, message);
    this.name = "NotFoundError";
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests, please try again later.") {
    super(429, ErrorCode.RATE_LIMITED, message);
    this.name = "RateLimitedError";
  }
}
