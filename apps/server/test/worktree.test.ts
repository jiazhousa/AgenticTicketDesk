import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRealContext, type TestContext } from './helpers.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

/** 在 worktree 内落一笔提交（内容带唯一标记） */
function commitIn(wtPath: string, filename: string): string {
  writeFileSync(path.join(wtPath, filename), `content ${Date.now()}\n`);
  git(wtPath, ['add', '-A']);
  git(wtPath, ['commit', '-m', `add ${filename}`]);
  return git(wtPath, ['rev-parse', 'HEAD']);
}

describe('worktree 管理器：allocate / 复用 / reclaim【B8】', () => {
  test('allocate：建 worktree+分支，基线=默认分支 HEAD', () => {
    const { worktree, repoPath } = createRealContext();
    const head = git(repoPath, ['rev-parse', 'main']);
    const p = worktree.allocate(101, repoPath);
    expect(existsSync(p)).toBe(true);
    expect(p).toContain('-t101');
    expect(git(repoPath, ['rev-parse', '--verify', 'refs/heads/atd/t101'])).toBe(head);
    expect(worktree.baseline(p)).toBe(head);
  });

  test('allocate 复用：同单二次分配同路径，既有提交保留', () => {
    const { worktree, repoPath } = createRealContext();
    const p1 = worktree.allocate(102, repoPath);
    const sha = commitIn(p1, 'r1.txt');
    const p2 = worktree.allocate(102, repoPath);
    expect(p2).toBe(p1);
    expect(git(p1, ['rev-parse', 'HEAD'])).toBe(sha);
    // 目标仓 worktree 列表仍只挂一份
    const list = git(
      execFileSync('git', ['-C', p1, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
      ['worktree', 'list'],
    );
    expect(list.split('\n').filter((l) => l.includes('-t102'))).toHaveLength(1);
  });

  test('reclaim keepBranch=true：目录删/分支留/commit 可达，再分配分支延续', () => {
    const { worktree, repoPath } = createRealContext();
    const p = worktree.allocate(103, repoPath);
    const sha = commitIn(p, 'keep.txt');
    worktree.reclaim(103, repoPath, true);
    expect(existsSync(p)).toBe(false);
    expect(git(repoPath, ['rev-parse', '--verify', 'refs/heads/atd/t103'])).toBe(sha);
    // 再分配：从既有分支挂回，提交仍在
    const p2 = worktree.allocate(103, repoPath);
    expect(readFileSync(path.join(p2, 'keep.txt'), 'utf8')).toContain('content');
    expect(git(p2, ['rev-parse', 'HEAD'])).toBe(sha);
  });

  test('reclaim keepBranch=false：worktree 与分支双删', () => {
    const { worktree, repoPath } = createRealContext();
    const p = worktree.allocate(104, repoPath);
    commitIn(p, 'drop.txt');
    worktree.reclaim(104, repoPath, false);
    expect(existsSync(p)).toBe(false);
    expect(() => git(repoPath, ['rev-parse', '--verify', 'refs/heads/atd/t104'])).toThrow();
  });
});

describe('worktree 回收路由', () => {
  function makeTicket(ctx: TestContext): number {
    const t = ctx.service.createTicket({ type: 'TASK', title: '回收任务' });
    ctx.service.submitSpec(t.id, '# spec');
    ctx.service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.worktree.allocate(t.id, ctx.repoPath);
    return t.id;
  }

  test('非终态（IN_PROGRESS）→ 422 WORKTREE_ACTIVE', async () => {
    const ctx = createRealContext();
    const id = makeTicket(ctx);
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/tickets/${id}/worktree` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('WORKTREE_ACTIVE');
    expect(existsSync(ctx.worktree.pathFor(id, ctx.repoPath))).toBe(true);
  });

  test('终态（DONE）默认 keepBranch=true：回收 200，分支保留', async () => {
    const ctx = createRealContext();
    const id = makeTicket(ctx);
    ctx.service.transition(id, 'DONE', { actor: 'system' });
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/tickets/${id}/worktree` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(existsSync(ctx.worktree.pathFor(id, ctx.repoPath))).toBe(false);
    expect(() =>
      execFileSync('git', ['-C', ctx.repoPath, 'rev-parse', '--verify', `refs/heads/atd/t${id}`]),
    ).not.toThrow();
  });

  test('终态 keepBranch=false：分支一并删除', async () => {
    const ctx = createRealContext();
    const id = makeTicket(ctx);
    ctx.service.transition(id, 'FAILED', { actor: 'system' });
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tickets/${id}/worktree?keepBranch=false`,
    });
    expect(res.statusCode).toBe(200);
    expect(() =>
      execFileSync('git', ['-C', ctx.repoPath, 'rev-parse', '--verify', `refs/heads/atd/t${id}`]),
    ).toThrow();
  });
});
