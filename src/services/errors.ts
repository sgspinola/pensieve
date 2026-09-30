export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = toErrorCode(this.name);
    this.status = status;
  }
}

function toErrorCode(className: string): string {
  // "NotFoundError" -> "NOT_FOUND", "ValidationError" -> "VALIDATION"
  return className
    .replace(/Error$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  issues: { field: string; message: string }[];

  constructor(message = "Validation failed", issues: { field: string; message: string }[] = []) {
    super(message, 400);
    this.issues = issues;
  }
}
