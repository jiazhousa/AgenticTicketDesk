import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { vi, describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { Ticket } from '../src/domain/ticket-service.js';
import { createRealContext, makeTempRepo, type TestContext } from './helpers.js';

// 本文件真实 spawn 子进程 + 双临时 git 仓操作，整体放宽超时
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** 构造双仓真实上下文：主仓 A（repoPath）+ readable 仓 B（repo-b） */
function makeDualRepoContext(): { ctx: TestContext; repoB: string } {
  const repoB = makeTempRepo();
  const ctx = createRealContext({ autoDispatch: true, extraRepos: [{ id: 'repo-b', path: repoB }] });
  return { ctx, repoB };
}

describe('跨仓真跑：TASK repoRef=B【S2w1 验收场景 2】', () => {
  test('worktree 目录落 {B仓basename}-t{N} 且 commit 在 B 仓分支；主仓无串仓', async () => {
    const { ctx, repoB } = makeDualRepoContext();
    const t = ctx.service.createTicket({ type: 'TASK', title: 'B 仓任务', repoRef: 'repo-b' });
    expect(t.workspaceId).toBe('atd');
    expect(t.repoRef).toBe('repo-b');
    ctx.service.submitSpec(t.id, '# spec\n\n在 B 仓写入产物');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'DISPATCHED', workerId: 'fake' },
    });
    expect(res.statusCode).toBe(200);

    const done = await waitStatus(ctx, t.id, ['DONE']);
    expect(done.round).toBe(1);

    // worktree 目录模板锚点：{dataDir}/worktrees/{repoName}-t{id}（repoName=B 仓 basename）
    const expectedWt = path.join(ctx.config.dataDir, 'worktrees', `${path.basename(repoB)}-t${t.id}`);
    expect(existsSync(expectedWt)).toBe(true);
    expect(existsSync(path.join(expectedWt, 'atd-artifact.txt'))).toBe(true);

    // commit 在 B 仓分支；落库 sha 与分支 HEAD 一致
    const head = git(repoB, ['rev-parse', '--verify', `refs/heads/atd/t${t.id}`]);
    const detail = ctx.service.getTicketDetail(t.id);
    expect(detail.commits).toEqual([{ round: 1, sha: head }]);

    // 主仓（A）无该单分支——跨仓隔离由 worktree 目录与分支承载
    expect(() => git(ctx.repoPath, ['rev-parse', '--verify', `refs/heads/atd/t${t.id}`])).toThrow();
  });

  test('缺省 repoRef=主仓：行为与 S2a 等价（worktree 落主仓名模板）', async () => {
    const { ctx } = makeDualRepoContext();
    const t = ctx.service.createTicket({ type: 'TASK', title: '主仓任务' });
    expect(t.repoRef).toBe('atd');
    ctx.service.submitSpec(t.id, '# spec');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'DISPATCHED', workerId: 'fake' },
    });
    expect(res.statusCode).toBe(200);
    await waitStatus(ctx, t.id, ['DONE']);
    const expectedWt = path.join(ctx.config.dataDir, 'worktrees', `${path.basename(ctx.repoPath)}-t${t.id}`);
    expect(existsSync(expectedWt)).toBe(true);
    git(ctx.repoPath, ['rev-parse', '--verify', `refs/heads/atd/t${t.id}`]);
  });
});

describe('跨仓编排链：Task1@A DONE → Task2@B 自动放行【S2w1 验收场景 3，D8】', () => {
  test('同 STORY 跨仓子任务链自动流转，两 worktree 独立落各自仓', async () => {
    const { ctx, repoB } = makeDualRepoContext();
    const story = ctx.service.createTicket({ type: 'STORY', title: '跨仓链' });
    // Task1@A：缺省主仓；Task2@B：repoRef=repo-b 且预绑定 worker（自动放行前提）
    const t1 = ctx.service.createTicket({ type: 'TASK', title: 'A 仓任务', parentId: story.id });
    const t2 = ctx.service.createTicket({
      type: 'TASK',
      title: 'B 仓任务',
      parentId: story.id,
      workerId: 'fake',
      repoRef: 'repo-b',
    });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.submitSpec(t2.id, '# spec');
    ctx.service.addDependency(t2.id, t1.id);

    // 放行 Task1（user 通道）→ 执行 DONE
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${t1.id}/transition`,
      payload: { to: 'DISPATCHED', workerId: 'fake' },
    });
    expect(res.statusCode).toBe(200);
    await waitStatus(ctx, t1.id, ['DONE']);
    // Task2 依赖满足 → system 自动放行（不做 repoRef 复校）→ 执行 DONE
    const done2 = await waitStatus(ctx, t2.id, ['DONE']);
    expect(done2.round).toBe(1);
    const d2 = ctx.service.getTicketDetail(t2.id);
    expect(d2.transitions.some((x) => x.note === '编排链依赖满足，自动放行')).toBe(true);

    // 两 worktree 独立落各自仓（目录模板互不串仓）
    const wt1 = path.join(ctx.config.dataDir, 'worktrees', `${path.basename(ctx.repoPath)}-t${t1.id}`);
    const wt2 = path.join(ctx.config.dataDir, 'worktrees', `${path.basename(repoB)}-t${t2.id}`);
    expect(existsSync(wt1)).toBe(true);
    expect(existsSync(wt2)).toBe(true);
    git(ctx.repoPath, ['rev-parse', '--verify', `refs/heads/atd/t${t1.id}`]);
    git(repoB, ['rev-parse', '--verify', `refs/heads/atd/t${t2.id}`]);
    expect(() => git(repoB, ['rev-parse', '--verify', `refs/heads/atd/t${t1.id}`])).toThrow();
    expect(() => git(ctx.repoPath, ['rev-parse', '--verify', `refs/heads/atd/t${t2.id}`])).toThrow();
  });
});
