/** 错误码全集；Fastify setErrorHandler 统一包裹为 { error: { code, message, details? } } */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'INVALID_TRANSITION'
  | 'USE_SPEC_ENDPOINT'
  | 'NOT_DRAFT'
  | 'BLOCKED_BY_PENDING'
  | 'CHILDREN_PENDING'
  | 'DAG_INVALID'
  | 'WORKER_REQUIRED'
  | 'WORKER_UNKNOWN'
  | 'WORKTREE_ACTIVE'
  | 'WORKTREE_SETUP'
  | 'MANUAL_FORBIDDEN'
  | 'RESOLUTION_INVALID'
  | 'PROMPT_TOO_LONG';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  INVALID_TRANSITION: 422,
  USE_SPEC_ENDPOINT: 422,
  NOT_DRAFT: 422,
  BLOCKED_BY_PENDING: 422,
  CHILDREN_PENDING: 422,
  DAG_INVALID: 422,
  WORKER_REQUIRED: 422,
  WORKER_UNKNOWN: 422,
  WORKTREE_ACTIVE: 422,
  WORKTREE_SETUP: 422,
  MANUAL_FORBIDDEN: 422,
  RESOLUTION_INVALID: 422,
  PROMPT_TOO_LONG: 422,
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
