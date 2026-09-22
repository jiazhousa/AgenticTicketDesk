/** 错误码全集（impl §2.4）；Fastify setErrorHandler 统一包裹为 { error: { code, message, details? } } */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'INVALID_TRANSITION'
  | 'USE_SPEC_ENDPOINT'
  | 'NOT_DRAFT'
  | 'BLOCKED_BY_PENDING'
  | 'CHILDREN_PENDING'
  | 'DAG_INVALID';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  INVALID_TRANSITION: 422,
  USE_SPEC_ENDPOINT: 422,
  NOT_DRAFT: 422,
  BLOCKED_BY_PENDING: 422,
  CHILDREN_PENDING: 422,
  DAG_INVALID: 422,
};

/** 领域错误：details 为人类可读明细数组（如未完成依赖单清单） */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}
