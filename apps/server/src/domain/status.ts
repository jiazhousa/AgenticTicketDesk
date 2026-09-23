/** M1 八态（值域全集，text 枚举不生成 DB CHECK，由 zod 兜底） */
export const TICKET_STATUSES = [
  'DRAFT',
  'SPEC_READY',
  'DISPATCHED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
  'BLOCKED',
  'FAILED',
] as const;
export type Status = (typeof TICKET_STATUSES)[number];

/** 工单类型（枚举全集一次建齐；BLOCKER 由编排层在 L3 升级时创建，DREAM 不接受创建） */
export const TICKET_TYPES = ['STORY', 'TASK', 'BLOCKER', 'DREAM'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/**
 * 转移白名单（边集封闭，user/system 通道共用）：SPEC_READY 只能经 submitSpec 进入，
 * transition() 不接受 to=SPEC_READY。
 */
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ['SPEC_READY'],
  SPEC_READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'BLOCKED', 'FAILED'],
  BLOCKED: ['IN_PROGRESS', 'DISPATCHED', 'FAILED', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
  FAILED: [],
};

/**
 * user 可达边（按 type 分流；system 通道可达全集）：
 * - STORY（纯编排，无执行）：人工边全集保留
 * - TASK（执行单）：DISPATCHED→IN_PROGRESS（dispatcher 进）/ IN_PROGRESS→DONE（结算进）等收口为 system 边，
 *   user 白名单=放行（需 workerId）/ 取消
 * - BLOCKER/DREAM：关单与升级走编排通道（resolve / dream job），无 user 边
 */
export function isUserEdge(type: TicketType, from: Status, to: Status): boolean {
  if (type === 'STORY') return true;
  if (type === 'TASK') {
    return (
      (from === 'SPEC_READY' && to === 'DISPATCHED') ||
      (from === 'SPEC_READY' && to === 'CANCELLED') ||
      (from === 'DISPATCHED' && to === 'CANCELLED') ||
      (from === 'BLOCKED' && to === 'CANCELLED')
    );
  }
  return false;
}
