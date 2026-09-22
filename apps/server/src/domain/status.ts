/** M1 六态（值域全集，text 枚举不生成 DB CHECK，由 zod 兜底） */
export const TICKET_STATUSES = [
  'DRAFT',
  'SPEC_READY',
  'DISPATCHED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const;
export type Status = (typeof TICKET_STATUSES)[number];

/** 工单类型（枚举全集一次建齐；S1 实际仅使用 STORY/TASK，BLOCKER/DREAM 不接受创建） */
export const TICKET_TYPES = ['STORY', 'TASK', 'BLOCKER', 'DREAM'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** 转移白名单（边集封闭）：SPEC_READY 只能经 submitSpec 进入，transition() 不接受 to=SPEC_READY */
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ['SPEC_READY'],
  SPEC_READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE'],
  DONE: [],
  CANCELLED: [],
};
