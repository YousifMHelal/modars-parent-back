export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  RESTORE_WINDOW_EXPIRED: "RESTORE_WINDOW_EXPIRED",
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

/** Username already taken or invitee already a parent (data-model.md §5). */
export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, ErrorCode.CONFLICT, message);
    this.name = "ConflictError";
  }
}

/** Child create/restore would exceed the plan's child-slot limit (FR-012, 409). */
export class PlanLimitReachedError extends AppError {
  constructor(message = "Plan child limit reached") {
    super(409, ErrorCode.PLAN_LIMIT_REACHED, message);
    this.name = "PlanLimitReachedError";
  }
}

/** Restore attempted after the 7-day soft-delete window (FR-017, 410). */
export class RestoreWindowExpiredError extends AppError {
  constructor(message = "Restore window has expired") {
    super(410, ErrorCode.RESTORE_WINDOW_EXPIRED, message);
    this.name = "RestoreWindowExpiredError";
  }
}
