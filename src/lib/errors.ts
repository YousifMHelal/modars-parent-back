export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  CONFLICT: "CONFLICT",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  RESTORE_WINDOW_EXPIRED: "RESTORE_WINDOW_EXPIRED",
  // Phase 5 — Payment & subscription
  SUBSCRIPTION_ALREADY_ACTIVE: "SUBSCRIPTION_ALREADY_ACTIVE",
  PRORATION_UNCOMPUTABLE: "PRORATION_UNCOMPUTABLE",
  RETAIN_WINDOW_ELAPSED: "RETAIN_WINDOW_ELAPSED",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
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

/** Authenticated but the object/resource belongs to another family (Principle V, 403). */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, ErrorCode.FORBIDDEN, message);
    this.name = "ForbiddenError";
  }
}

/** Storage backend unreachable while serving a file (FR-015, 503). */
export class StorageUnavailableError extends AppError {
  constructor(message = "Storage temporarily unavailable") {
    super(503, ErrorCode.STORAGE_UNAVAILABLE, message);
    this.name = "StorageUnavailableError";
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

// ── Phase 5: Payment & subscription errors ────────────────────────────────────

/** Initiate attempted on an already-active subscription (FR-001, 409). */
export class SubscriptionAlreadyActiveError extends AppError {
  constructor(message = "Subscription is already active") {
    super(409, ErrorCode.SUBSCRIPTION_ALREADY_ACTIVE, message);
    this.name = "SubscriptionAlreadyActiveError";
  }
}

/** Proration could not be computed (zero/inverted period, or not at slot limit) (422). */
export class ProrationUncomputableError extends AppError {
  constructor(message = "Proration could not be computed") {
    super(422, ErrorCode.PRORATION_UNCOMPUTABLE, message);
    this.name = "ProrationUncomputableError";
  }
}

/** Reactivate attempted after the cancel retain window elapsed (FR-022, 422). */
export class RetainWindowElapsedError extends AppError {
  constructor(message = "The reactivation window has elapsed") {
    super(422, ErrorCode.RETAIN_WINDOW_ELAPSED, message);
    this.name = "RetainWindowElapsedError";
  }
}

/** Webhook signature verification failed (FR-007, 400) — leaks nothing about state. */
export class WebhookSignatureInvalidError extends AppError {
  constructor(message = "Invalid webhook signature") {
    super(400, ErrorCode.WEBHOOK_SIGNATURE_INVALID, message);
    this.name = "WebhookSignatureInvalidError";
  }
}

/** Provider-reported amount did not match the server-computed expected amount (FR-017, 422). */
export class AmountMismatchError extends AppError {
  constructor(message = "Payment amount mismatch") {
    super(422, ErrorCode.AMOUNT_MISMATCH, message);
    this.name = "AmountMismatchError";
  }
}
