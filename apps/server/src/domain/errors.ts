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
  | 'PROMPT_TOO_LONG'
  | 'WORKSPACE_UNKNOWN'
  | 'REPO_REF_INVALID'
  | 'REPO_REF_DRIFTED'
  | 'CROSS_WORKSPACE'
  | 'FILE_SET_CONFLICT'
  | 'WORKER_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_TERMINATED';

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
  WORKSPACE_UNKNOWN: 422,
  REPO_REF_INVALID: 422,
  REPO_REF_DRIFTED: 422,
  CROSS_WORKSPACE: 422,
  FILE_SET_CONFLICT: 422,
  /** humanthink serve 不可用（degraded）——工单功能不受影响 */
  WORKER_UNAVAILABLE: 503,
  SESSION_NOT_FOUND: 404,
  /** 已删（软删除）会话的操作性端点统一拒绝 */
  SESSION_TERMINATED: 422,
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
