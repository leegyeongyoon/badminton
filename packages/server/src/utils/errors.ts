export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource}을(를) 찾을 수 없습니다`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '인증이 필요합니다') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '권한이 없습니다') {
    super(403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}
