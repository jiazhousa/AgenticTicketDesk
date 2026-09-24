import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi, describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { Ticket } from '../src/domain/ticket-service.js';
import { FIXTURES_DIR, createRealContext, type TestContext } from './helpers.js';
import { readReport } from '../src/report.js';

// 本文件真实 spawn 子进程 + 临时 git 仓操作，整体放宽超时
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function fixtureCmd(name: string): string {
  return `node ${path.join(FIXTURES_DIR, name)} {{worktree}} {{prompt}}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 建单+提交 spec+HTTP 放行（autoDispatch 已开），返回工单 id */
async function dispatchTicket(ctx: TestContext, workerId: string): Promise<number> {
  const t = ctx.service.createTicket({ type: 'TASK', title: '测试任务' });
  ctx.service.submitSpec(t.id, '# spec\n\n写文件并提交');
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/tickets/${t.id}/transition`,
    payload: { to: 'DISPATCHED', workerId },
  });
  expect(res.statusCode).toBe(200);
  return t.id;
}

/** 轮询工单状态直至命中（超时失败并报告当前状态） */
async function waitStatus(
  ctx: TestContext,
  id: number,
  wanted: Status[],
  timeoutMs = 20_000,
): Promise<Ticket> {
  const deadline = Date.now() + timeoutMs;
  let last = '?';
  while (Date.now() < deadline) {
    last = ctx.service.getTicket(id).status;
    if (wanted.includes(last as Status)) return ctx.service.getTicket(id);
    await sleep(150);
  }
  throw new Error(`等待状态 ${wanted.join('/')} 超时（当前 ${last}，工单 #${id}）`);
}

/** 轮询直至进程彻底消亡（ESRCH；孤儿进程由 init 收殓需稍等） */
async function waitEsrch(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
    await sleep(100);
  }
  return false;
}

/** 解析 raw JSONL：返回首行 meta 与末行 exit 元数据 */
function readRawMeta(rawPath: string): { first: Record<string, unknown>; last: Record<string, unknown> } {
  const lines = readFileSync(rawPath, 'utf8').split('\n').filter(Boolean);
  return { first: JSON.parse(lines[0]), last: JSON.parse(lines.at(-1)!) };
}

describe('B1：全链——放行→worktree→spawn→报告 done→commits 落库→DONE', () => {
  test('fake-done 全链闭环', async () => {
    const ctx = createRealContext({ autoDispatch: true });
    const id = await dispatchTicket(ctx, 'fake');

    const done = await waitStatus(ctx, id, ['DONE']);
    expect(done.round).toBe(1);
    expect(done.workerId).toBe('fake');

    // commit 关联落库，sha 与 worktree 实际 HEAD 一致
    const wt = ctx.worktree.pathFor('atd', id, ctx.repoPath);
    const head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const detail = ctx.service.getTicketDetail(id);
    expect(detail.commits).toEqual([{ round: 1, sha: head }]);
    // worktree 内可见 commit（含初始基线共 2 笔）+ 产物文件
    expect(existsSync(path.join(wt, 'atd-artifact.txt'))).toBe(true);
    const logCount = execFileSync('git', ['-C', wt, 'rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    expect(Number(logCount)).toBe(2);
    // 报告落库
    expect(detail.report).toMatchObject({ round: 1, status: 'done' });
    // 双 JSONL 落盘 + raw 首行元数据
    const rawPath = path.join(ctx.config.dataDir, 'logs', `t${id}.r1.raw.jsonl`);
    const eventsPath = path.join(ctx.config.dataDir, 'logs', `t${id}.r1.events.jsonl`);
    expect(existsSync(rawPath)).toBe(true);
    expect(existsSync(eventsPath)).toBe(true);
    const { first } = readRawMeta(rawPath);
    expect(first.meta).toBe(true);
    expect(first.round).toBe(1);
    expect(String(first.command)).toContain('fake-done.mjs');
  });
});

describe('B3：卡点三裁决（BLOCK_MODE 参数化分轮）', () => {
  test('B3a 终止：blocked 报告→原单 BLOCKED(pending:l3)+blockReason 内联→裁决 abort→FAILED', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fb', command: fixtureCmd('fake-blocked.mjs') }] });
    const id = await dispatchTicket(ctx, 'fb');
    const blocked = await waitStatus(ctx, id, ['BLOCKED']);
    expect(blocked.pendingLabel).toBe('l3');
    expect(blocked.round).toBe(1);

    // 内联卡点：原单 blockReason 落库 + system 留言（时间线可见全文）
    const detail = ctx.service.getTicketDetail(id);
    expect(detail.ticket.blockReason).toContain('外部审批未通过');
    const commentsA = detail.comments;
    expect(commentsA.at(-1)).toMatchObject({ authorType: 'system' });
    expect(commentsA.at(-1)!.content).toContain('外部审批未通过');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${id}/resolve`,
      payload: { resolution: 'abort', note: '终止方案' },
    });
    expect(res.statusCode).toBe(200);
    await waitStatus(ctx, id, ['FAILED']);
    // 转出 BLOCKED 清空卡点字段
    expect(ctx.service.getTicket(id).blockReason).toBeNull();
  });

  test('B3b 继续：原 worktree round+1 重 spawn→DONE（BLOCK_MODE=done）', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fb', command: fixtureCmd('fake-blocked.mjs') }] });
    const id = await dispatchTicket(ctx, 'fb');
    await waitStatus(ctx, id, ['BLOCKED']);

    process.env.BLOCK_MODE = 'done';
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/tickets/${id}/resolve`,
        payload: { resolution: 'continue', note: '按方案 B 继续' },
      });
      expect(res.statusCode).toBe(200);

      const done = await waitStatus(ctx, id, ['DONE']);
      expect(done.round).toBe(2);
      // 报告=最大轮（round 2 done）
      expect(ctx.service.getTicketDetail(id).report).toMatchObject({ round: 2, status: 'done' });
      // 原 worktree 复用：两轮日志对都在
      expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${id}.r1.raw.jsonl`))).toBe(true);
      expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${id}.r2.raw.jsonl`))).toBe(true);
      // 裁决 note 落原单留言
      const comments = ctx.service.getTicketDetail(id).comments;
      expect(comments.at(-1)).toMatchObject({ authorType: 'user', content: '按方案 B 继续' });
    } finally {
      delete process.env.BLOCK_MODE;
    }
  });

  test('B3c 改派：原 worktree 复用（分支延续保留 r1 commits）+ 新 profile 完成', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      profiles: [
        { id: 'fb', command: fixtureCmd('fake-blocked.mjs') },
        { id: 'falt', command: fixtureCmd('fake-done.mjs') },
      ],
    });
    const id = await dispatchTicket(ctx, 'fb');
    await waitStatus(ctx, id, ['BLOCKED']);
    const wt = ctx.worktree.pathFor('atd', id, ctx.repoPath);
    // r1（blocked 轮）的 marker 提交
    const r1Sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${id}/resolve`,
      payload: { resolution: 'reassign', reassignWorkerId: 'falt' },
    });
    expect(res.statusCode).toBe(200);

    const done = await waitStatus(ctx, id, ['DONE']);
    expect(done.round).toBe(2);
    expect(done.workerId).toBe('falt');
    // 分支延续：r1 提交仍在历史中（新 worker 的提交叠加其上）
    expect(() =>
      execFileSync('git', ['-C', wt, 'merge-base', '--is-ancestor', r1Sha, 'HEAD']),
    ).not.toThrow();
    expect(existsSync(path.join(wt, 'atd-artifact.txt'))).toBe(true);
    expect(existsSync(path.join(wt, 'blocked-mark.txt'))).toBe(true);
  });
});

describe('B4：崩溃——退出码非 0 → FAILED + 双 JSONL + 注入摘要', () => {
  test('spawn 命令不存在 → pre-spawn 路径 CANCELLED 可重派（不落 FAILED 终态）', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'ghost', command: 'nonexistent-cmd-atd-xyz {{prompt}}' }] });
    const id = await dispatchTicket(ctx, 'ghost');
    await waitStatus(ctx, id, ['CANCELLED']);
    const detail = ctx.service.getTicketDetail(id);
    const lastComment = detail.comments.at(-1);
    expect(lastComment?.content).toContain('无法启动');
  });

  test('fake-crash 全链', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fc', command: fixtureCmd('fake-crash.mjs') }] });
    const id = await dispatchTicket(ctx, 'fc');
    await waitStatus(ctx, id, ['FAILED']);

    const rawPath = path.join(ctx.config.dataDir, 'logs', `t${id}.r1.raw.jsonl`);
    const eventsPath = path.join(ctx.config.dataDir, 'logs', `t${id}.r1.events.jsonl`);
    expect(existsSync(rawPath)).toBe(true);
    expect(existsSync(eventsPath)).toBe(true);
    // raw 首行元数据含 permission 注入摘要（deny 规则可见）
    const { first, last } = readRawMeta(rawPath);
    expect(first.meta).toBe(true);
    const injection = first.permissionInjection as Record<string, unknown>;
    expect(injection.envKeys).toEqual(['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG']);
    const raw = readFileSync(rawPath, 'utf8');
    expect(raw).toContain('"git push":"deny"');
    expect(raw).toContain('"git remote *":"deny"');
    // 末行 exit 元数据：退出码 1
    expect(last.exitCode).toBe(1);
    // 留言说明崩溃
    const comments = ctx.service.getTicketDetail(id).comments;
    expect(comments.at(-1)!.content).toContain('异常退出');
  });
});

describe('B5：超时——杀进程组（子+孙进程均 ESRCH）', () => {
  test('fake-sleep + timeoutOverrideMs=300 → FAILED + 进程组全灭', async () => {
    const grandPidFile = path.join(tmpdir(), `atdb5-${Date.now()}.pid`);
    process.env.GRANDCHILD_PID_FILE = grandPidFile;
    try {
      const ctx = createRealContext({
        autoDispatch: true,
        timeoutOverrideMs: 300,
        profiles: [{ id: 'fs', command: fixtureCmd('fake-sleep.mjs') }],
      });
      const id = await dispatchTicket(ctx, 'fs');
      await waitStatus(ctx, id, ['FAILED']);

      // raw 末行 exit 元数据：timedOut=true + child pid
      const rawPath = path.join(ctx.config.dataDir, 'logs', `t${id}.r1.raw.jsonl`);
      const { last } = readRawMeta(rawPath);
      expect(last.timedOut).toBe(true);
      const childPid = last.pid as number;
      const grandPid = Number(readFileSync(grandPidFile, 'utf8').trim());
      // 进程组全灭断言：子进程与孙进程均 ESRCH（孙进程被 init 收殓需稍等，轮询兜底）
      expect(childPid).toBeGreaterThan(1);
      expect(grandPid).toBeGreaterThan(1);
      expect(await waitEsrch(childPid)).toBe(true);
      expect(await waitEsrch(grandPid)).toBe(true);
      // 超时留言 + 状态 FAILED
      const comments = ctx.service.getTicketDetail(id).comments;
      expect(comments.at(-1)!.content).toContain('超时');
    } finally {
      delete process.env.GRANDCHILD_PID_FILE;
    }
  });
});

describe('B6：报告缺失——L2 重试（round=2 可见）→ 仍缺 → L3 BLOCKER（留言含 raw 路径）', () => {
  test('fake-noreport 全链', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      retryOnReportMiss: 1,
      profiles: [{ id: 'fn', command: fixtureCmd('fake-noreport.mjs') }],
    });
    const id = await dispatchTicket(ctx, 'fn');
    const blocked = await waitStatus(ctx, id, ['BLOCKED'], 25_000);
    // 重试一轮后升级：round=2 可见
    expect(blocked.round).toBe(2);
    expect(blocked.pendingLabel).toBe('l3');

    const detail = ctx.service.getTicketDetail(id);
    // 内联卡点：原单 blockReason 含最后一轮 raw 路径 + system 留言全文
    expect(detail.ticket.blockReason).toContain('报告缺失');
    expect(detail.ticket.blockReason).toContain(`t${id}.r2.raw.jsonl`);
    const last = detail.comments.at(-1)!;
    expect(last.authorType).toBe('system');
    expect(last.content).toContain('报告缺失');
    expect(last.content).toContain(`t${id}.r2.raw.jsonl`);
    // 两轮日志都在
    expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${id}.r1.raw.jsonl`))).toBe(true);
    expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${id}.r2.raw.jsonl`))).toBe(true);
  });
});

describe('pre-spawn 运行期失败 → DISPATCHED→CANCELLED + 留言', () => {
  test('worktree 路径被普通文件占用 → CANCELLED，留言含派发失败', async () => {
    const ctx = createRealContext({ autoDispatch: true });
    const t = ctx.service.createTicket({ type: 'TASK', title: '占用任务' });
    ctx.service.submitSpec(t.id, '# spec');
    // 提前用普通文件占住 worktree 路径（allocate 复用分支→后续 git 操作失败）
    mkdirSync(path.join(ctx.config.dataDir, 'worktrees'), { recursive: true });
    writeFileSync(ctx.worktree.pathFor('atd', t.id, ctx.repoPath), 'not a dir');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'DISPATCHED', workerId: 'fake' },
    });
    expect(res.statusCode).toBe(200);
    const cancelled = await waitStatus(ctx, t.id, ['CANCELLED']);
    expect(cancelled.status).toBe('CANCELLED');
    const comments = ctx.service.getTicketDetail(t.id).comments;
    expect(comments.at(-1)!.content).toContain('派发失败');
  });
});

describe('recoverOnStartup：重启恢复', () => {
  test('IN_PROGRESS→FAILED + 留言；DISPATCHED→CANCELLED + 留言', async () => {
    const ctx = createRealContext();
    // 两张执行单（service 层直推，不触发 spawn）
    const a = ctx.service.createTicket({ type: 'TASK', title: '执行中' });
    ctx.service.submitSpec(a.id, '# spec');
    ctx.service.transition(a.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(a.id, 'IN_PROGRESS', { actor: 'system' });
    const b = ctx.service.createTicket({ type: 'TASK', title: '派发停留' });
    ctx.service.submitSpec(b.id, '# spec');
    ctx.service.transition(b.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    // STORY 人工态不受恢复影响
    const s = ctx.service.createTicket({ type: 'STORY', title: '人工故事' });
    ctx.service.submitSpec(s.id, '# spec');
    ctx.service.transition(s.id, 'DISPATCHED', { actor: 'user' });
    ctx.service.transition(s.id, 'IN_PROGRESS', { actor: 'user' });

    ctx.dispatcher.recoverOnStartup();

    expect(ctx.service.getTicket(a.id).status).toBe('FAILED');
    expect(ctx.service.getTicketDetail(a.id).comments.at(-1)!.content).toContain('服务重启中断');
    expect(ctx.service.getTicket(b.id).status).toBe('CANCELLED');
    expect(ctx.service.getTicketDetail(b.id).comments.at(-1)!.content).toContain('派发失败');
    expect(ctx.service.getTicket(s.id).status).toBe('IN_PROGRESS');
  });
});

describe('F1/F4：终态重开与编排链自动放行（验收反馈）', () => {
  test('reopen：DONE 单留言重开 → 原 worktree round=2 续跑 → DONE；留言注入轮次上下文', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fd', command: fixtureCmd('fake-done.mjs') }] });
    const id = await dispatchTicket(ctx, 'fd');
    await waitStatus(ctx, id, ['DONE']);
    expect(ctx.service.getTicket(id).round).toBe(1);
    // 重开：留言即指令 → DISPATCHED → 同 worktree 第二轮
    ctx.dispatcher.reopen(id, { message: '问题尚未解决：请再补一个文件 docs/reopen.md' });
    await waitStatus(ctx, id, ['DONE']);
    const t = ctx.service.getTicket(id);
    expect(t.round).toBe(2);
    const detail = ctx.service.getTicketDetail(id);
    // 重开留言落库（user）
    expect(detail.comments.some((c) => c.authorType === 'user' && c.content.includes('问题尚未解决'))).toBe(true);
    // 第二轮 prompt 含轮次上下文与用户指令
    const prompt2 = readFileSync(path.join(ctx.config.dataDir, 'prompts', `t${id}.r2.md`), 'utf8');
    expect(prompt2).toContain('问题尚未解决');
    expect(prompt2).toContain('轮次上下文');
  });

  test('编排链自动放行：并行 1/2 全 DONE → 下游 3（blockedBy 1+2）自动 DISPATCHED 并执行', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fd', command: fixtureCmd('fake-done.mjs') }] });
    const story = ctx.service.createTicket({ type: 'STORY', title: '编排链' });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '并行1', parentId: story.id });
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '并行2', parentId: story.id });
    const t3 = ctx.service.createTicket({ type: 'TASK', title: '下游', parentId: story.id, workerId: 'fd' });
    for (const t of [t1, t2, t3]) {
      ctx.service.submitSpec(t.id, '# spec');
    }
    ctx.service.addDependency(t3.id, t1.id);
    ctx.service.addDependency(t3.id, t2.id);
    // 放行 1、2（3 的依赖未齐不能放行）
    for (const tid of [t1.id, t2.id]) {
      const r = await ctx.app.inject({ method: 'POST', url: `/api/tickets/${tid}/transition`, payload: { to: 'DISPATCHED', workerId: 'fd' } });
      expect(r.statusCode).toBe(200);
    }
    // 3 在依赖齐前放行被拒
    const { captureError } = await import('./helpers.js');
    const err = captureError(() => ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fd' }));
    expect(err.code).toBe('BLOCKED_BY_PENDING');
    await waitStatus(ctx, t1.id, ['DONE']);
    await waitStatus(ctx, t2.id, ['DONE']);
    // 1、2 全 DONE → 3 自动放行并执行完成
    await waitStatus(ctx, t3.id, ['DONE']);
    const d3 = ctx.service.getTicketDetail(t3.id);
    expect(d3.transitions.some((x) => x.note === '编排链依赖满足，自动放行')).toBe(true);
  });

  test('独立单（无 parent）不自动放行：上游 DONE 后仍 SPEC_READY', async () => {
    const ctx = createRealContext({ autoDispatch: true, profiles: [{ id: 'fd', command: fixtureCmd('fake-done.mjs') }] });
    const a = ctx.service.createTicket({ type: 'TASK', title: '独立上游' });
    const b = ctx.service.createTicket({ type: 'TASK', title: '独立下游' });
    ctx.service.submitSpec(a.id, '# spec');
    ctx.service.submitSpec(b.id, '# spec');
    ctx.service.addDependency(b.id, a.id);
    const r = await ctx.app.inject({ method: 'POST', url: `/api/tickets/${a.id}/transition`, payload: { to: 'DISPATCHED', workerId: 'fd' } });
    expect(r.statusCode).toBe(200);
    await waitStatus(ctx, a.id, ['DONE']);
    // b 无 parent：不自动放行，保持人工控制
    expect(ctx.service.getTicket(b.id).status).toBe('SPEC_READY');
  });
});

describe('报告 schema 容忍 null 字段【S2w1 hotfix】', () => {
  test('atd-report.json 显式 null 的 commits/blockReason 可正常解析（done）', () => {
    const dir = path.join(tmpdir(), `atd-report-null-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'atd-report.json'),
      JSON.stringify({ status: 'done', summary: 's', commits: null, blockReason: null }));
    const r = readReport(dir);
    expect(r.ok).toBe(true);
  });
});
