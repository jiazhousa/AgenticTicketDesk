import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildAgentRules,
  buildAgentSystem,
  buildServeConfig,
  extractUserGlobal,
  stripJsonc,
  writeServeConfig,
  type VisionWorker,
  type VisionWorkspace,
} from '../../src/humanthink/config-gen.js';

const WS: VisionWorkspace[] = [
  {
    id: 'atd',
    primary: 'atd',
    repos: [
      { id: 'atd', path: '/home/u/proj/atd', role: 'primary' },
      { id: 'docs', path: '/home/u/proj/docs', role: 'readable' },
    ],
  },
  { id: 'blog', primary: 'blog', repos: [{ id: 'blog', path: '/srv/blog', role: 'primary' }] },
];

const WORKERS: VisionWorker[] = [
  { id: 'oc', name: 'OpenCode', capabilities: ['task', 'interactive'] },
  { id: 'plain', name: 'Plain', capabilities: ['task'] },
];

describe('config-gen：权限规则序列硬编码【S2b1】', () => {
  test('五规则顺序与形态（catch-all 首条 + deny + read + per readable 两条）', () => {
    expect(buildAgentRules(WS[0])).toEqual([
      { action: '*', resource: '*', effect: 'ask' },
      { action: 'external_directory', resource: '/**', effect: 'deny' },
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'external_directory', resource: '/home/u/proj/docs/*', effect: 'allow' },
      { action: 'read', resource: '/home/u/proj/docs/*', effect: 'allow' },
    ]);
  });

  test('primary 仓不生成 ④⑤（会话目录内读走规则③与实例豁免，探针实证）', () => {
    const rules = buildAgentRules(WS[0]);
    expect(rules.some((r) => r.resource.includes('/atd/'))).toBe(false);
  });

  test('无 readable 仓时仅前三条', () => {
    expect(buildAgentRules(WS[1])).toHaveLength(3);
  });
});

describe('config-gen：用户全局提取（白名单/禁入键/V1/jsonc）【S2b1】', () => {
  test('白名单 {model, providers} 复制，其余键（agents/permissions 等）一概不进', () => {
    const raw = JSON.stringify({
      model: 'zhipu/glm-5.3',
      providers: { zhipu: { baseURL: 'https://x', apiKey: 'sk-local' } },
      agents: { build: { mode: 'primary' } },
      permissions: { bash: { '*': 'allow' } },
      compaction: { enabled: true },
    });
    expect(extractUserGlobal(raw)).toEqual({
      model: 'zhipu/glm-5.3',
      providers: { zhipu: { baseURL: 'https://x', apiKey: 'sk-local' } },
    });
  });

  test('V1 键形（单数 provider map）提取等价语义到 providers；单数键绝不原样复制', () => {
    const raw = JSON.stringify({ model: 'openai/gpt', provider: { openai: { apiKey: 'k' } }, permission: { edit: 'ask' } });
    const out = extractUserGlobal(raw);
    expect(out).toEqual({ model: 'openai/gpt', providers: { openai: { apiKey: 'k' } } });
    expect('provider' in out).toBe(false);
    expect('permission' in out).toBe(false);
  });

  test('jsonc：注释与尾随内容剥除后可解析，字符串内注释符保留', () => {
    const jsonc = [
      '{',
      '  // 行注释',
      '  "model": "a/b", /* 块注释 */',
      '  "providers": { "p": { "note": "keep // and /* in string" } }',
      '}',
    ].join('\n');
    const out = extractUserGlobal(jsonc);
    expect(out.model).toBe('a/b');
    expect((out.providers as { p: { note: string } }).p.note).toBe('keep // and /* in string');
  });

  test('stripJsonc 转义字符串不误判', () => {
    expect(stripJsonc('{"a":"say \\"hi\\"//x"}')).toBe('{"a":"say \\"hi\\"//x"}');
  });

  test('用户全局缺失/损坏 → 空提取（仅生成 agents 段，模型缺失由冒烟暴露）', () => {
    expect(extractUserGlobal(null)).toEqual({});
    expect(extractUserGlobal('')).toEqual({});
    expect(extractUserGlobal('{broken')).toEqual({});
  });
});

describe('config-gen：完整配置生成与幂等写入【S2b1】', () => {
  test('agents 段按 workspace 展开且不含禁入键，system=产出合同提示', () => {
    const cfg = buildServeConfig({ model: 'm/x' }, WS, WORKERS) as Record<string, unknown>;
    expect(Object.keys(cfg).sort()).toEqual(['agents', 'model']);
    const agents = cfg.agents as Record<string, { system: string; permissions: unknown[] }>;
    expect(Object.keys(agents).sort()).toEqual(['atd-ht-atd', 'atd-ht-blog']);
    expect(agents['atd-ht-atd'].permissions).toHaveLength(5);
    expect(agents['atd-ht-blog'].permissions).toHaveLength(3);
    // system 为非空字符串（产出合同注入生效）
    for (const key of Object.keys(agents)) {
      expect(typeof agents[key]!.system).toBe('string');
      expect(agents[key]!.system.length).toBeGreaterThan(0);
    }
    // 输出对象顶层禁入键断言（单数 agent/provider/permission 永不出现）
    for (const banned of ['agent', 'provider', 'permission']) {
      expect(banned in cfg).toBe(false);
    }
  });

  test('写目标仅生成目录内 opencode.json，幂等重写生效', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'htcfg-'));
    const cfg1 = buildServeConfig({}, WS, WORKERS);
    writeServeConfig(dir, cfg1);
    const file = path.join(dir, 'opencode.json');
    expect(existsSync(file)).toBe(true);
    const first = readFileSync(file, 'utf8');
    // 幂等重写：内容变化时整体覆盖（无追加/残留）
    writeServeConfig(dir, buildServeConfig({ model: 'm/y' }, WS, WORKERS));
    const second = readFileSync(file, 'utf8');
    expect(second).not.toBe(first);
    expect(second).toContain('"model": "m/y"');
    // 生成目录外无写入
    expect(existsSync(path.join(dir, 'opencode.jsonc'))).toBe(false);
  });
});

describe('config-gen：system 产出合同（S2b2 单助手双职责）', () => {
  test('模板快照锁定（格式范例/业务语言要求/字段约束固定）', () => {
    expect(buildAgentSystem(WS[0]!, WORKERS)).toMatchSnapshot();
    expect(buildAgentSystem(WS[1]!, [])).toMatchSnapshot();
  });

  test('动态注入：本 workspace 仓清单（id+primary 标记+路径）与 worker 清单', () => {
    const sys = buildAgentSystem(WS[0]!, WORKERS);
    // repos 段：id/主仓标记/可读仓标记/路径逐项可见；repoRef 缺省值=主仓 id
    expect(sys).toContain('- atd（主仓）：/home/u/proj/atd');
    expect(sys).toContain('- docs（可读仓）：/home/u/proj/docs');
    expect(sys).toContain('缺省=主仓（atd）');
    // workers 段：id/名称/capabilities
    expect(sys).toContain('- oc（OpenCode）：capabilities=[task, interactive]');
    expect(sys).toContain('- plain（Plain）：capabilities=[task]');
    // 计划块协议：atd-plan fenced 范例 + 业务语言要求 + 尾斜杠语义 + 局部 id 引用约束
    expect(sys).toContain('```atd-plan');
    expect(sys).toContain('"story"');
    expect(sys).toContain('业务语言');
    expect(sys).toContain('目录以 / 结尾表示整目录递归');
    expect(sys).toContain('只能引用本计划内出现的 id');
    // 双职责声明：明确要求才拆单
    expect(sys).toContain('用户未明确要求提单时保持讨论');
  });

  test('按 workspace 隔离：blog 视野不含 atd 仓；空 worker 清单有兜底提示', () => {
    const sys = buildAgentSystem(WS[1]!, WORKERS);
    expect(sys).toContain('- blog（主仓）：/srv/blog');
    expect(sys).not.toContain('/home/u/proj/atd');
    const empty = buildAgentSystem(WS[1]!, []);
    expect(empty).toContain('（当前无已注册 worker，需先注册后再拆单）');
  });
});
