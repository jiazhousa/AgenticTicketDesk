import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadWorkspaces } from '../src/workspaces.js';

/** 构造一个「repoRoot 含 workspaces/ 目录」的临时根（yaml 内容原样写入，覆盖相对/~ 形态） */
function makeRoot(): { root: string; wsDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'atdroot-'));
  const wsDir = path.join(root, 'workspaces');
  mkdirSync(wsDir);
  return { root, wsDir };
}

function writeWs(wsDir: string, file: string, content: string): void {
  writeFileSync(path.join(wsDir, file), content);
}

describe('workspaces 声明式加载【S2w1 FR-1】', () => {
  test('合法双仓 yaml 解析正确：repos/primary/绝对路径', () => {
    const { root, wsDir } = makeRoot();
    const repoA = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    const repoB = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    writeWs(
      wsDir,
      'dual.yaml',
      ['id: dual-ws', 'name: 双仓', 'repos:', `  - id: repo-a`, `    path: ${repoA}`, '    role: primary', '  - id: repo-b', `    path: ${repoB}`, '    role: readable', ''].join('\n'),
    );
    const registry = loadWorkspaces(root);
    const ws = registry.get('dual-ws')!;
    expect(ws.name).toBe('双仓');
    expect(ws.primary).toBe('repo-a');
    expect(ws.repos).toHaveLength(2);
    expect(ws.repos[0]).toEqual({ id: 'repo-a', path: repoA, role: 'primary' });
    expect(ws.repos[1]).toEqual({ id: 'repo-b', path: repoB, role: 'readable' });
    // 查询：repoRef 命中 readable 仓；缺省=主仓；未知 repoRef → null
    expect(registry.resolveRepoPath('dual-ws', 'repo-b')).toBe(repoB);
    expect(registry.resolveRepoPath('dual-ws', null)).toBe(repoA);
    expect(registry.resolveRepoPath('dual-ws', undefined)).toBe(repoA);
    expect(registry.resolveRepoPath('dual-ws', 'nope')).toBeNull();
    expect(registry.resolveRepoPath('unknown-ws', null)).toBeNull();
  });

  test('相对 path 基于 repoRoot 解析', () => {
    const { root, wsDir } = makeRoot();
    mkdirSync(path.join(root, 'repos', 'inner'), { recursive: true });
    writeWs(
      wsDir,
      'rel.yaml',
      ['id: rel-ws', 'name: 相对', 'repos:', '  - id: inner', '    path: repos/inner', '    role: primary', ''].join('\n'),
    );
    const registry = loadWorkspaces(root);
    expect(registry.resolveRepoPath('rel-ws', null)).toBe(path.resolve(root, 'repos/inner'));
  });

  test('~ 展开形态解析', () => {
    const { root, wsDir } = makeRoot();
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'atdhome-'));
    mkdirSync(path.join(fakeHome, 'repo-x'), { recursive: true });
    const prevHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      writeWs(
        wsDir,
        'tilde.yaml',
        ['id: tilde-ws', 'name: 波浪', 'repos:', '  - id: x', '    path: ~/repo-x', '    role: primary', ''].join('\n'),
      );
      const registry = loadWorkspaces(root);
      expect(registry.resolveRepoPath('tilde-ws', null)).toBe(path.join(fakeHome, 'repo-x'));
    } finally {
      process.env.HOME = prevHome;
    }
  });

  test('path 不存在 → 加载失败信息含文件名', () => {
    const { root, wsDir } = makeRoot();
    writeWs(
      wsDir,
      'badpath.yaml',
      ['id: bad-ws', 'name: 坏路径', 'repos:', '  - id: gone', '    path: /nonexistent/atd/repo-gone', '    role: primary', ''].join('\n'),
    );
    expect(() => loadWorkspaces(root)).toThrow(/badpath\.yaml/);
    expect(() => loadWorkspaces(root)).toThrow(/repo-gone/);
  });

  test('双 primary → 加载失败含文件名', () => {
    const { root, wsDir } = makeRoot();
    const a = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    const b = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    writeWs(
      wsDir,
      'dupprimary.yaml',
      [
        'id: dup-p',
        'name: 双主仓',
        'repos:',
        `  - id: a`, `    path: ${a}`, '    role: primary',
        `  - id: b`, `    path: ${b}`, '    role: primary',
        '',
      ].join('\n'),
    );
    expect(() => loadWorkspaces(root)).toThrow(/dupprimary\.yaml/);
    expect(() => loadWorkspaces(root)).toThrow(/primary/);
  });

  test('workspace 内 repo id 重复 → 加载失败含文件名', () => {
    const { root, wsDir } = makeRoot();
    const a = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    writeWs(
      wsDir,
      'duprepo.yaml',
      [
        'id: dup-r',
        'name: 重复仓',
        'repos:',
        `  - id: a`, `    path: ${a}`, '    role: primary',
        `  - id: a`, `    path: ${a}`, '    role: readable',
        '',
      ].join('\n'),
    );
    expect(() => loadWorkspaces(root)).toThrow(/duprepo\.yaml/);
    expect(() => loadWorkspaces(root)).toThrow(/repo id 重复/);
  });

  test('workspace id 跨文件重复 → 加载失败含文件名', () => {
    const { root, wsDir } = makeRoot();
    const a = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    const b = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    writeWs(wsDir, 'one.yaml', ['id: same-id', 'name: 一', 'repos:', `  - id: a`, `    path: ${a}`, '    role: primary', ''].join('\n'));
    writeWs(wsDir, 'two.yaml', ['id: same-id', 'name: 二', 'repos:', `  - id: b`, `    path: ${b}`, '    role: primary', ''].join('\n'));
    // 两个文件都可能作为冲突方报出，断言错误含后注册的文件名与冲突 id
    expect(() => loadWorkspaces(root)).toThrow(/two\.yaml/);
    expect(() => loadWorkspaces(root)).toThrow(/same-id/);
  });

  test('无 workspaces 目录 → 加载失败含模板指引', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atdroot-'));
    expect(() => loadWorkspaces(root)).toThrow(/workspaces 目录缺失/);
    expect(() => loadWorkspaces(root)).toThrow(/atd\.yaml/);
  });

  test('workspaces 目录为空 → 加载失败（缺省 workspace 无从谈起，不兜底合成）', () => {
    const { root } = makeRoot();
    expect(() => loadWorkspaces(root)).toThrow(/workspaces 目录为空/);
    expect(() => loadWorkspaces(root)).toThrow(/atd\.yaml/);
  });

  test('非法 id 形态（非 kebab-case）→ 校验失败含文件名', () => {
    const { root, wsDir } = makeRoot();
    const a = mkdtempSync(path.join(tmpdir(), 'atdrepo-'));
    writeWs(
      wsDir,
      'badid.yaml',
      ['id: Bad_ID', 'name: 坏id', 'repos:', `  - id: a`, `    path: ${a}`, '    role: primary', ''].join('\n'),
    );
    expect(() => loadWorkspaces(root)).toThrow(/badid\.yaml/);
    expect(() => loadWorkspaces(root)).toThrow(/kebab-case/);
  });
});
