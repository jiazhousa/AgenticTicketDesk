import { describe, expect, test } from 'vitest';
import { finishFromExit, mapOpencodeEvents } from '../src/map-events.js';
import { parseLine } from '../src/parse-line.js';

describe('opencode 事件映射（四类 + 错误态）', () => {
  test('step_start → turn-start（携带 timestamp）', () => {
    expect(mapOpencodeEvents({ type: 'step_start', timestamp: 123, part: { type: 'step-start' } })).toEqual([
      { type: 'turn-start', timestamp: 123 },
    ]);
  });

  test('text 整段 → text-start + text-delta(全文一次) + text-end', () => {
    const events = mapOpencodeEvents({ type: 'text', timestamp: 1, part: { type: 'text', text: '你好 世界' } });
    expect(events).toEqual([
      { type: 'text-start', timestamp: 1 },
      { type: 'text-delta', timestamp: 1, text: '你好 世界' },
      { type: 'text-end', timestamp: 1 },
    ]);
  });

  test('tool_use completed → tool-call + tool-result（无错误标记）', () => {
    const events = mapOpencodeEvents({
      type: 'tool_use',
      part: { type: 'tool', tool: 'write', state: { status: 'completed', input: {} } },
    });
    expect(events).toEqual([
      { type: 'tool-call', timestamp: undefined, tool: 'write' },
      { type: 'tool-result', timestamp: undefined, tool: 'write', errored: false },
    ]);
  });

  test('tool_use error → tool-result 携带 errored=true', () => {
    const events = mapOpencodeEvents({
      type: 'tool_use',
      part: { type: 'tool', tool: 'bash', state: { status: 'error' } },
    });
    expect(events[1]).toMatchObject({ type: 'tool-result', tool: 'bash', errored: true });
  });

  test('step_finish → turn-end（携带 reason）', () => {
    expect(
      mapOpencodeEvents({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } }),
    ).toEqual([{ type: 'turn-end', timestamp: undefined, reason: 'stop' }]);
  });

  test('未知类型 / 非对象 → 空数组', () => {
    expect(mapOpencodeEvents({ type: 'unknown_event' })).toEqual([]);
    expect(mapOpencodeEvents('not-an-object')).toEqual([]);
    expect(mapOpencodeEvents(null)).toEqual([]);
  });

  test('finishFromExit：退出码 0 → finish(success)；非 0 → 无事件', () => {
    expect(finishFromExit(0)).toEqual([{ type: 'finish', success: true }]);
    expect(finishFromExit(1)).toEqual([]);
    expect(finishFromExit(null)).toEqual([]);
  });
});

describe('单行 JSONL 解析（非法行跳过）', () => {
  test('JSON 行正常解析（对象与数组）', () => {
    expect(parseLine('{"type":"text"}')).toEqual({ kind: 'json', value: { type: 'text' } });
    expect(parseLine('  [1,2] ')).toEqual({ kind: 'json', value: [1, 2] });
  });

  test('非 JSON 行 / 空行 / 截断 JSON → 跳过', () => {
    expect(parseLine('some plain text')).toEqual({ kind: 'skipped' });
    expect(parseLine('')).toEqual({ kind: 'skipped' });
    expect(parseLine('   ')).toEqual({ kind: 'skipped' });
    expect(parseLine('{"broken": ')).toEqual({ kind: 'skipped' });
  });
});
