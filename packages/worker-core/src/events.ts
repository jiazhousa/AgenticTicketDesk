/**
 * 统一事件流（HarnessV1 命名对齐）。
 * 各 worker 协议的原生事件由对应映射包（如 @atd/worker-opencode）转为本形态后落盘。
 */
export type UnifiedEvent =
  | { type: 'turn-start'; timestamp?: number }
  | { type: 'turn-end'; timestamp?: number; reason?: string }
  | { type: 'text-start'; timestamp?: number }
  | { type: 'text-delta'; timestamp?: number; text: string }
  | { type: 'text-end'; timestamp?: number }
  | { type: 'tool-call'; timestamp?: number; tool: string }
  | { type: 'tool-result'; timestamp?: number; tool: string; errored?: boolean }
  | { type: 'finish'; timestamp?: number; success: boolean };
