import { describe, expect, test } from 'vitest';
import type { UnifiedEvent } from '../src/events.js';
import {
  DEFAULT_SERVE_COMMAND,
  isInteractiveServeCompatible,
  renderServeCommand,
  validateProfile,
} from '../src/profile.js';

/** interactive 声明合法模板（与 workers/opencode.yaml S2b1 形态同构） */
const INTERACTIVE = [
  'id: oc',
  'name: OpenCode',
  'protocol: spawn-cli',
  'capabilities: [task, interactive]',
  'command: opencode run --standalone --format json {{prompt}}',
  'interactive:',
  '  serveCommand: opencode serve --port {port}',
].join('\n');

describe('profile interactive 段校验【S2b1】', () => {
  test('interactive 段可整体缺省（capabilities 单 task 不受影响）', () => {
    const p = validateProfile(
      ['id: t', 'name: T', 'protocol: spawn-cli', 'capabilities: [task]', 'command: echo hi'].join('\n'),
      't.yaml',
    );
    expect(p.interactive).toBeUndefined();
    expect(isInteractiveServeCompatible(p)).toBe(false);
  });

  test('interactive 段缺省 serveCommand → 采用缺省模板且可用', () => {
    const yaml = INTERACTIVE.replace('  serveCommand: opencode serve --port {port}', '');
    const p = validateProfile(yaml, 'default.yaml');
    expect(p.interactive).toEqual({});
    expect(DEFAULT_SERVE_COMMAND).toBe('opencode serve --port {port}');
    expect(isInteractiveServeCompatible(p)).toBe(true);
    expect(renderServeCommand(p, 4901)).toEqual(['opencode', 'serve', '--port', '4901']);
  });

  test('显式 serveCommand 通过校验并按参数数组渲染', () => {
    const p = validateProfile(INTERACTIVE, 'explicit.yaml');
    expect(p.interactive?.serveCommand).toBe('opencode serve --port {port}');
    expect(renderServeCommand(p, 4990)).toEqual(['opencode', 'serve', '--port', '4990']);
  });

  test('serveCommand 缺 {port} 占位符 → 拒绝注册', () => {
    const yaml = INTERACTIVE.replace('serveCommand: opencode serve --port {port}', 'serveCommand: opencode serve');
    expect(() => validateProfile(yaml, 'noport.yaml')).toThrowError(/\{port\}/);
  });

  test('interactive 段凭据扫描复用：serveCommand 含疑似 key → 拒绝', () => {
    const yaml = INTERACTIVE.replace(
      'serveCommand: opencode serve --port {port}',
      'serveCommand: opencode serve --port {port} --token sk-abc123def456gh',
    );
    expect(() => validateProfile(yaml, 'sk.yaml')).toThrowError(/sk-/);
  });

  test('非 opencode serve 形态的 interactive worker → 标记不可用（MVP 单 serve 边界）', () => {
    const yaml = INTERACTIVE.replace(
      'serveCommand: opencode serve --port {port}',
      'serveCommand: pi-agent serve --port {port}',
    );
    const p = validateProfile(yaml, 'pi.yaml');
    expect(p.capabilities).toContain('interactive');
    expect(isInteractiveServeCompatible(p)).toBe(false);
    // 渲染仍可用（serve 形态演进时无需改 schema），仅聊天框不列出
    expect(renderServeCommand(p, 5000)).toEqual(['pi-agent', 'serve', '--port', '5000']);
  });

  test('capabilities 仅 task 但声明 interactive 段 → 段可存在不参与判定', () => {
    const yaml = [
      'id: t2',
      'name: T2',
      'protocol: spawn-cli',
      'capabilities: [task]',
      'command: echo hi',
      'interactive:',
      '  serveCommand: opencode serve --port {port}',
    ].join('\n');
    const p = validateProfile(yaml, 't2.yaml');
    expect(isInteractiveServeCompatible(p)).toBe(false);
  });
});

describe('UnifiedEvent 扩展两型【S2b1】', () => {
  test('reasoning 型携带 phase 与全文', () => {
    const ev: UnifiedEvent = { type: 'reasoning', text: '思考全文', phase: 'ended', timestamp: 1 };
    expect(ev.phase).toBe('ended');
  });

  test('permission_request 型 pending/resolved 同型并存（审批历史回溯并入）', () => {
    const pending: UnifiedEvent = {
      type: 'permission_request',
      requestID: 'per_1',
      action: 'shell',
      resources: ['echo hi'],
      status: 'pending',
    };
    const resolved: UnifiedEvent = { ...pending, status: 'resolved', decision: 'once' };
    expect(pending.status).toBe('pending');
    expect(resolved.decision).toBe('once');
  });
});
