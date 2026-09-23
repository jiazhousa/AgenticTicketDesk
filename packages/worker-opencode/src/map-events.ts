import type { UnifiedEvent } from '@atd/worker-core';

/**
 * opencode 原生事件（--format json 逐行输出）→ 统一事件流。
 * 实测契约：
 * - step_start → turn-start
 * - text（整段）→ text-start + text-delta(全文一次) + text-end
 * - tool_use（state.completed）→ tool-call + tool-result
 * - tool_use（state.error）→ tool-call + tool-result(errored=true)
 * - step_finish → turn-end（携带 reason）
 * - 无法识别的行 → 空数组（由调用方跳过）
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

export function mapOpencodeEvents(msg: unknown): UnifiedEvent[] {
  const rec = asRecord(msg);
  if (!rec) return [];
  const timestamp = typeof rec.timestamp === 'number' ? rec.timestamp : undefined;
  const part = asRecord(rec.part);

  switch (rec.type) {
    case 'step_start':
      return [{ type: 'turn-start', timestamp }];
    case 'text': {
      const text = typeof part?.text === 'string' ? part.text : '';
      return [
        { type: 'text-start', timestamp },
        { type: 'text-delta', timestamp, text },
        { type: 'text-end', timestamp },
      ];
    }
    case 'tool_use': {
      const tool = typeof part?.tool === 'string' ? part.tool : 'unknown';
      const state = asRecord(part?.state);
      const errored = state?.status === 'error';
      return [
        { type: 'tool-call', timestamp, tool },
        { type: 'tool-result', timestamp, tool, errored },
      ];
    }
    case 'step_finish': {
      const reason = typeof part?.reason === 'string' ? part.reason : undefined;
      return [{ type: 'turn-end', timestamp, reason }];
    }
    default:
      return [];
  }
}

/** 进程退出 → finish 语义：仅退出码 0 视为成功收尾，非 0 不产生 finish（由判定表处置） */
export function finishFromExit(code: number | null): UnifiedEvent[] {
  if (code === 0) return [{ type: 'finish', success: true }];
  return [];
}
