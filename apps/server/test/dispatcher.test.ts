import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi, describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { Ticket } from '../src/domain/ticket-service.js';
import { ticketFiles } from '../src/db/schema.js';
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

/** 建单+提交 spec+HTTP 放行（autoDispatch 已开；闸门满时响应为排队单），返回工单 id */
async function dispatchTicket(
  ctx: TestContext,
  workerId: string,
  opts: { title?: string; plannedFiles?: string[] } = {},
): Promise<number> {
  const t = ctx.service.createTicket({ type: 'TASK', title: opts.title ?? '测试任务' });
  ctx.service.submitSpec(t.id, '# spec\n\n写文件并提交', opts.plannedFiles);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/tickets/${t.id}/transition`,
    payload: { to: 'DISPATCHED', workerId },
  });
  expect(res.statusCode).toBe(200);
  return t.id;
}

/** 轮询直至谓词命中（超时失败并报告当前快照） */
async function waitTicket(
  ctx: TestContext,
  id: number,
  pred: (t: Ticket) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<Ticket> {
  const deadline = Date.now() + timeoutMs;
  let last = ctx.service.getTicket(id);
  while (Date.now() < deadline) {
    last = ctx.service.getTicket(id);
    if (pred(last)) return last;
    await sleep(150);
  }
  throw new Error(`等待 ${what} 超时（当前 status=${last.status} retryCount=${last.retryCount}，工单 #${id}）`);
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

describe('B6：报告缺失——RETRY_WAIT 自愈（60/120/240 退避）→ 耗尽当次升级 l3【S3 语义更新】', () => {
  test('fake-noreport：入 BLOCKED(agent) 带 retry_at；注入时钟断言三档退避；第 4 次进入即升级', async () => {
    const T0 = 1_700_000_000_000;
    let clock = T0;
    const ctx = createRealContext({
      autoDispatch: true,
      maxRetries: 3,
      retryBackoffSec: 60,
      tickIntervalMs: 25,
      now: () => clock,
      profiles: [{ id: 'fn', command: fixtureCmd('fake-noreport.mjs') }],
    });
    const id = await dispatchTicket(ctx, 'fn');

    // 第 1 次缺失：BLOCKED(agent)，retryCount=1，retry_at=clock+60s（不再原地立即重试）
    const w1 = await waitTicket(ctx, id, (t) => t.status === 'BLOCKED' && t.pendingLabel === 'agent' && t.retryCount === 1, '第 1 次 RETRY_WAIT');
    expect(w1.round).toBe(1);
    expect(w1.retryAt).toBe(T0 + 60_000);
    expect(w1.blockReason).toContain('报告缺失');
    expect(w1.blockReason).toContain(`t${id}.r1.raw.jsonl`);

    // 推进 60s → tick 唤醒 round=2 → 再次缺失：count=2，退避 120s
    clock += 60_000;
    const w2 = await waitTicket(ctx, id, (t) => t.status === 'BLOCKED' && t.retryCount === 2, '第 2 次 RETRY_WAIT');
    expect(w2.round).toBe(2);
    expect(w2.retryAt).toBe(T0 + 60_000 + 120_000);

    // 推进 120s → round=3：count=3，退避 240s（封顶档全可达）
    clock += 120_000;
    const w3 = await waitTicket(ctx, id, (t) => t.status === 'BLOCKED' && t.retryCount === 3, '第 3 次 RETRY_WAIT');
    expect(w3.round).toBe(3);
    expect(w3.retryAt).toBe(T0 + 180_000 + 240_000);

    // 推进 240s → 第 4 次进入即升级：pending:l3 + 历次摘要 + system 留言，无额外 transitions 行
    clock += 240_000;
    const esc = await waitTicket(ctx, id, (t) => t.status === 'BLOCKED' && t.pendingLabel === 'l3', '升级 l3');
    expect(esc.round).toBe(4);
    expect(esc.retryAt).toBeNull();
    expect(esc.blockReason).toContain('报告缺失重试 3 次后仍失败');
    expect(esc.blockReason).toContain('失败轮次 1..4');
    expect(esc.blockReason).toContain(`t${id}.r4.raw.jsonl`);
    const detail = ctx.service.getTicketDetail(id);
    const lastComment = detail.comments.at(-1)!;
    expect(lastComment.authorType).toBe('system');
    expect(lastComment.content).toContain('重试耗尽升级人工裁决');
    // 无额外 transitions 行：4 次缺失=4 条 IN_PROGRESS→BLOCKED，无 BLOCKED→BLOCKED 同态行
    const blockRows = detail.transitions.filter((x) => x.toStatus === 'BLOCKED');
    expect(blockRows.length).toBe(4);
    expect(blockRows.every((x) => x.fromStatus === 'IN_PROGRESS')).toBe(true);
    // 唤醒轮均有留痕（3 次到期重试）
    expect(detail.transitions.filter((x) => x.note === 'RETRY_WAIT 到期，自动重试').length).toBe(3);
    // 四轮日志齐
    for (const r of [1, 2, 3, 4]) {
      expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${id}.r${r}.raw.jsonl`))).toBe(true);
    }
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

describe('闸门排队：FIFO 恢复与饥饿免疫【S3】', () => {
  test('闸门=1：二三单排队 GATE_QUEUED，前单 DONE 后 FIFO 依次唤醒执行', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 1,
      profiles: [{ id: 'fd', command: fixtureCmd('fake-done.mjs') }],
    });
    const t1 = await dispatchTicket(ctx, 'fd', { title: '先执行' });
    const t2 = await dispatchTicket(ctx, 'fd', { title: '排队一' });
    const t3 = await dispatchTicket(ctx, 'fd', { title: '排队二' });
    // 排队判定：status=SPEC_READY + queuedReason + worker_id 早绑定
    for (const tid of [t2, t3]) {
      const q = ctx.service.getTicket(tid);
      expect(q.status).toBe('SPEC_READY');
      expect(q.queuedReason).toBe('GATE_QUEUED');
      expect(q.workerId).toBe('fd');
    }
    expect(ctx.service.getTicket(t2).queuedAt!).toBeLessThanOrEqual(ctx.service.getTicket(t3).queuedAt!);

    await waitStatus(ctx, t1, ['DONE']);
    await waitStatus(ctx, t2, ['DONE']);
    await waitStatus(ctx, t3, ['DONE']);
    // 放行成功清空排队字段
    expect(ctx.service.getTicket(t2).queuedReason).toBeNull();
    // FIFO 序：t2 的唤醒转移行先于 t3
    const wake = (tid: number) =>
      ctx.service.getTicketDetail(tid).transitions.find((x) => x.note === '排队唤醒，自动放行')!;
    expect(wake(t2).id).toBeLessThan(wake(t3).id);
  });

  test('饥饿免疫：前单超时 FAILED → 排队单被唤醒', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 1,
      timeoutOverrideMs: 300,
      profiles: [
        { id: 'fs', command: fixtureCmd('fake-sleep.mjs') },
        { id: 'fd', command: fixtureCmd('fake-done.mjs') },
      ],
    });
    const t1 = await dispatchTicket(ctx, 'fs', { title: '超时单' });
    const t2 = await dispatchTicket(ctx, 'fd', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    await waitStatus(ctx, t1, ['FAILED']);
    await waitStatus(ctx, t2, ['DONE']);
  });

  test('饥饿免疫：前单崩溃 FAILED → 排队单被唤醒', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 1,
      profiles: [
        { id: 'fc', command: fixtureCmd('fake-crash.mjs') },
        { id: 'fd', command: fixtureCmd('fake-done.mjs') },
      ],
    });
    const t1 = await dispatchTicket(ctx, 'fc', { title: '崩溃单' });
    const t2 = await dispatchTicket(ctx, 'fd', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    await waitStatus(ctx, t1, ['FAILED']);
    await waitStatus(ctx, t2, ['DONE']);
  });

  test('饥饿免疫：preSpawnFail→CANCELLED → 排队单被唤醒（直调路径）', async () => {
    const ctx = createRealContext({ autoDispatch: false, maxConcurrentPerRepo: 1 });
    // t1 service 直推占闸（不触发 spawn），t2 HTTP 放行落队
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '派发失败单' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = await dispatchTicket(ctx, 'fake', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    // 占用 t1 worktree 路径为普通文件 → startRound allocate 失败 → preSpawnFail→CANCELLED + 唤醒
    mkdirSync(path.join(ctx.config.dataDir, 'worktrees'), { recursive: true });
    writeFileSync(ctx.worktree.pathFor('atd', t1.id, ctx.repoPath), 'not a dir');
    await ctx.dispatcher.startRound(t1.id);
    expect(ctx.service.getTicket(t1.id).status).toBe('CANCELLED');
    await waitStatus(ctx, t2, ['DONE']);
    expect(
      ctx.service.getTicketDetail(t2).transitions.some((x) => x.note === '排队唤醒，自动放行'),
    ).toBe(true);
  });

  test('饥饿免疫：worker 报 blocked → 前单 BLOCKED → 排队单被唤醒', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 1,
      profiles: [
        { id: 'fb', command: fixtureCmd('fake-blocked.mjs') },
        { id: 'fd', command: fixtureCmd('fake-done.mjs') },
      ],
    });
    const t1 = await dispatchTicket(ctx, 'fb', { title: '卡点单' });
    const t2 = await dispatchTicket(ctx, 'fd', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    await waitStatus(ctx, t1, ['BLOCKED']);
    await waitStatus(ctx, t2, ['DONE']);
    // 前单保持 BLOCKED 不被波及
    expect(ctx.service.getTicket(t1).status).toBe('BLOCKED');
  });

  test('user 取消边（DISPATCHED→CANCELLED）经 service 回调释放闸门 → 排队单唤醒', async () => {
    const ctx = createRealContext({ autoDispatch: false, maxConcurrentPerRepo: 1 });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '被取消单' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = await dispatchTicket(ctx, 'fake', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    // HTTP 取消（user 边）→ service 回调 releaseAndRecheck → t2 唤醒真跑
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t1.id}/transition`,
      payload: { to: 'CANCELLED' },
    });
    expect(res.statusCode).toBe(200);
    await waitStatus(ctx, t2, ['DONE']);
  });

  test('abort→FAILED 裁决尾直调 releaseAndRecheck → 排队单唤醒', async () => {
    const ctx = createRealContext({ autoDispatch: false, maxConcurrentPerRepo: 1 });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '卡点单' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t1.id, 'IN_PROGRESS', { actor: 'system' });
    const t2 = await dispatchTicket(ctx, 'fake', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');
    // t1 入 BLOCKED（service 直推，不经 settle——不触发唤醒）
    ctx.service.transition(t1.id, 'BLOCKED', { actor: 'system', blockReason: 'x' });
    expect(ctx.service.getTicket(t2).status).toBe('SPEC_READY');
    // 裁决 abort → FAILED + 直调重校验 → t2 唤醒
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t1.id}/resolve`,
      payload: { resolution: 'abort', note: '终止' },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.service.getTicket(t1.id).status).toBe('FAILED');
    await waitStatus(ctx, t2, ['DONE']);
  });
});

describe('RETRY_WAIT tick 恢复：闸门满顺延与重启重建【S3】', () => {
  test('到期但闸门满 → retry_at 顺延一个 tick（不落 queued 不转移）；闸门释放后唤醒续跑', async () => {
    const T0 = 1_700_000_000_000;
    let clock = T0;
    const TICK = 25;
    const ctx = createRealContext({
      autoDispatch: false,
      maxConcurrentPerRepo: 1,
      tickIntervalMs: TICK,
      now: () => clock,
    });
    // t2 先入 RETRY_WAIT 且已到期（此步闸门空闲，walk 不受阻）
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '自愈单' });
    ctx.service.submitSpec(t2.id, '# spec');
    ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t2.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(t2.id, 'BLOCKED', {
      actor: 'system',
      pendingLabel: 'agent',
      blockReason: '报告缺失',
      retryCount: 1,
      retryAt: clock - 1,
    });
    // t1 占闸（IN_PROGRESS，不 spawn）
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '占位单' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t1.id, 'IN_PROGRESS', { actor: 'system' });
    // 等三个 tick：首次顺延后未到新 retry_at，不再连续顺延
    await sleep(TICK * 3);
    const mid = ctx.service.getTicket(t2.id);
    expect(mid.status).toBe('BLOCKED');
    expect(mid.pendingLabel).toBe('agent');
    expect(mid.retryAt).toBe(T0 + TICK);
    expect(mid.queuedReason).toBeNull();
    // 释放闸门 + 推进时钟 → 唤醒续跑 round=2 → DONE
    ctx.service.transition(t1.id, 'DONE', { actor: 'system' });
    clock += 1_000;
    const done = await waitStatus(ctx, t2.id, ['DONE']);
    expect(done.round).toBe(1); // 此前轮次为 service 直推（未 spawn），本次唤醒即首轮真实执行
    expect(done.retryAt).toBeNull();
    expect(done.retryCount).toBe(1); // 唤醒不清计数（连续失败计数保留）
  });

  test('重启恢复：到期 RETRY_WAIT 立即恢复执行；未到期不动；排队单重校验一轮', async () => {
    const ctx = createRealContext({ autoDispatch: false, maxConcurrentPerRepo: 1, tickIntervalMs: 3_600_000 });
    // t1 RETRY_WAIT 已到期（先走，闸门空闲；BLOCKED 不占闸门）
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '自愈单' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t1.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(t1.id, 'BLOCKED', {
      actor: 'system',
      pendingLabel: 'agent',
      blockReason: '报告缺失',
      retryCount: 1,
      retryAt: Date.now() - 1_000,
    });
    // t4 RETRY_WAIT 未到期（重启后不动，计时器由 tick 重建）
    const t4 = ctx.service.createTicket({ type: 'TASK', title: '未到期自愈单' });
    ctx.service.submitSpec(t4.id, '# spec');
    ctx.service.transition(t4.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t4.id, 'IN_PROGRESS', { actor: 'system' });
    const t4RetryAt = Date.now() + 3_600_000;
    ctx.service.transition(t4.id, 'BLOCKED', {
      actor: 'system',
      pendingLabel: 'agent',
      blockReason: '报告缺失',
      retryCount: 1,
      retryAt: t4RetryAt,
    });
    // t3 派发停留（重启收敛 CANCELLED，释放闸门）
    const t3 = ctx.service.createTicket({ type: 'TASK', title: '派发停留' });
    ctx.service.submitSpec(t3.id, '# spec');
    ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    // t2 排队（闸门被 t3 占用）
    const t2 = await dispatchTicket(ctx, 'fake', { title: '排队单' });
    expect(ctx.service.getTicket(t2).queuedReason).toBe('GATE_QUEUED');

    ctx.dispatcher.recoverOnStartup();

    // t3 收敛（附留言）
    expect(ctx.service.getTicket(t3.id).status).toBe('CANCELLED');
    expect(ctx.service.getTicketDetail(t3.id).comments.at(-1)!.content).toContain('派发失败');
    // t1 到期即恢复 → 执行 → DONE
    await waitStatus(ctx, t1.id, ['DONE']);
    expect(ctx.service.getTicketDetail(t1.id).transitions.some((x) => x.note === 'RETRY_WAIT 到期，自动重试')).toBe(true);
    // t1 DONE 释放闸门 → 排队单 t2 唤醒执行
    await waitStatus(ctx, t2, ['DONE']);
    // t4 未到期：保持 BLOCKED(agent)，计时参数原样
    const t4After = ctx.service.getTicket(t4.id);
    expect(t4After.status).toBe('BLOCKED');
    expect(t4After.pendingLabel).toBe('agent');
    expect(t4After.retryAt).toBe(t4RetryAt);
  });
});

describe('实测防线：DONE settle 交叉预警【S3】', () => {
  test('T1 未声明真跑 → 与在途声明单 T2 相交 → 双方各落 system 预警；状态不变', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 3,
      profiles: [{ id: 'fd', command: fixtureCmd('fake-done.mjs') }],
    });
    // T1 先 HTTP 放行（立即占闸执行）；T2/T3 service 直推占占用集，不 spawn
    const t1 = await dispatchTicket(ctx, 'fd', { title: '实测单' });
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '在途声明单' });
    ctx.service.submitSpec(t2.id, '# spec', ['atd-artifact.txt']);
    ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fd' });
    const t3 = ctx.service.createTicket({ type: 'TASK', title: '在途无关单' });
    ctx.service.submitSpec(t3.id, '# spec', ['docs/']);
    ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fd' });

    await waitStatus(ctx, t1, ['DONE']);

    // 实测清单落库（fake-done 改 atd-artifact.txt）
    const t1Files = ctx.db.select().from(ticketFiles).all().filter((f) => f.ticketId === t1).map((f) => f.path);
    expect(t1Files).toContain('atd-artifact.txt');
    // 双留言预警
    const c1 = ctx.service.getTicketDetail(t1).comments.at(-1)!;
    expect(c1.authorType).toBe('system');
    expect(c1.content).toContain('实测防线预警');
    expect(c1.content).toContain(`#${t2.id}`);
    expect(c1.content).toContain('atd-artifact.txt');
    const c2 = ctx.service.getTicketDetail(t2.id).comments.at(-1)!;
    expect(c2.authorType).toBe('system');
    expect(c2.content).toContain(`#${t1}`);
    // 无关单不预警、被预警单状态不变
    expect(ctx.service.getTicketDetail(t3.id).comments.some((c) => c.content.includes('实测防线预警'))).toBe(false);
    expect(ctx.service.getTicket(t2.id).status).toBe('DISPATCHED');
  });
});

describe('两单并行真跑隔离（双 fake worker）【S3 验收 1】', () => {
  test('同时放行：worktree/分支/日志/commit/产物互不干扰', async () => {
    const ctx = createRealContext({
      autoDispatch: true,
      maxConcurrentPerRepo: 2,
      profiles: [
        { id: 'fa', command: `node ${path.join(FIXTURES_DIR, 'fake-done-arg.mjs')} {{worktree}} {{prompt}} alpha` },
        { id: 'fb', command: `node ${path.join(FIXTURES_DIR, 'fake-done-arg.mjs')} {{worktree}} {{prompt}} beta` },
      ],
    });
    const t1 = await dispatchTicket(ctx, 'fa', { title: '并行甲', plannedFiles: ['atd-artifact-alpha.txt'] });
    const t2 = await dispatchTicket(ctx, 'fb', { title: '并行乙', plannedFiles: ['atd-artifact-beta.txt'] });
    // 两单并行执行（均不排队）
    const s1 = ctx.service.getTicket(t1).status;
    expect(['DISPATCHED', 'IN_PROGRESS', 'DONE']).toContain(s1);
    await waitStatus(ctx, t1, ['DONE']);
    await waitStatus(ctx, t2, ['DONE']);

    // worktree 隔离：各存各自产物、无对方产物
    const wt1 = ctx.worktree.pathFor('atd', t1, ctx.repoPath);
    const wt2 = ctx.worktree.pathFor('atd', t2, ctx.repoPath);
    expect(wt1).not.toBe(wt2);
    expect(existsSync(path.join(wt1, 'atd-artifact-alpha.txt'))).toBe(true);
    expect(existsSync(path.join(wt1, 'atd-artifact-beta.txt'))).toBe(false);
    expect(existsSync(path.join(wt2, 'atd-artifact-beta.txt'))).toBe(true);
    expect(existsSync(path.join(wt2, 'atd-artifact-alpha.txt'))).toBe(false);
    // 分支隔离：各挂各的 atd/atd-t{id}
    const br1 = execFileSync('git', ['-C', wt1, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    const br2 = execFileSync('git', ['-C', wt2, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(br1).toBe(`atd/atd-t${t1}`);
    expect(br2).toBe(`atd/atd-t${t2}`);
    // commit 隔离：各自 HEAD 与各自落库 commit 一致，两单 sha 不同
    const head1 = execFileSync('git', ['-C', wt1, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const head2 = execFileSync('git', ['-C', wt2, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const d1 = ctx.service.getTicketDetail(t1);
    const d2 = ctx.service.getTicketDetail(t2);
    expect(d1.commits).toEqual([{ round: 1, sha: head1 }]);
    expect(d2.commits).toEqual([{ round: 1, sha: head2 }]);
    expect(head1).not.toBe(head2);
    // 日志隔离：各自 r1 日志对
    for (const tid of [t1, t2]) {
      expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${tid}.r1.raw.jsonl`))).toBe(true);
      expect(existsSync(path.join(ctx.config.dataDir, 'logs', `t${tid}.r1.events.jsonl`))).toBe(true);
    }
    // 声明不相交 + 实测各归各：无交叉预警
    expect(d1.comments.some((c) => c.content.includes('实测防线预警'))).toBe(false);
    expect(d2.comments.some((c) => c.content.includes('实测防线预警'))).toBe(false);
  });
});
