/**
 * 统一事件流（HarnessV1 命名对齐）。
 * 各 worker 协议的原生事件由对应映射包（如 @atd/worker-opencode）转为本形态后落盘。
 * interactive 长会话（S2b1 humanthink）扩展 reasoning / permission_request 两型：
 * 审批历史回溯（asked 与 replied 裁决）并入 permission_request 同型，以 status 区分。
 */
export type UnifiedEvent =
  | { type: 'turn-start'; timestamp?: number }
  | { type: 'turn-end'; timestamp?: number; reason?: string }
  | { type: 'text-start'; timestamp?: number }
  | { type: 'text-delta'; timestamp?: number; text: string }
  | { type: 'text-end'; timestamp?: number }
  | { type: 'reasoning'; timestamp?: number; text: string; phase: 'started' | 'ended' }
  | { type: 'tool-call'; timestamp?: number; tool: string }
  | { type: 'tool-result'; timestamp?: number; tool: string; errored?: boolean }
  | { type: 'permission_request'; timestamp?: number; requestID: string; action: string; resources: string[]; status: 'pending' | 'resolved'; decision?: string }
  | { type: 'finish'; timestamp?: number; success: boolean };
