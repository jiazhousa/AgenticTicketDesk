import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_SUBDIRS } from './config.js';
import { AppError } from './domain/errors.js';

/** git 直调（不经 shell）；失败抛出带 stderr 的 Error */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')} 失败（${cwd}）：${(e.stderr ?? e.message).trim()}`);
  }
}

/**
 * worktree 管理（编排层独占）：worktree 建在 dataDir 管理目录，不在目标仓内；
 * 分支 atd/t{id} 建在目标仓 refs（正常 git 操作）。路径 {dataDir}/worktrees/{repoName}-t{id}。
 */
export class WorktreeManager {
  private readonly repoName: string;

  constructor(
    private readonly repoPath: string,
    private readonly dataDir: string,
  ) {
    this.repoName = path.basename(path.resolve(repoPath));
  }

  /** 工单 worktree 路径（不校验存在性） */
  pathFor(ticketId: number): string {
    return path.join(this.dataDir, 'worktrees', `${this.repoName}-t${ticketId}`);
  }

  /** 工单分支名 */
  branchFor(ticketId: number): string {
    return `atd/t${ticketId}`;
  }

  /**
   * 前置可建性校验（放行三件套之③）：dataDir 四子目录可写 + 目标仓可访问且为 git 仓。
   * 失败抛 WORKTREE_SETUP。
   */
  assertReady(): void {
    try {
      for (const sub of DATA_SUBDIRS) {
        mkdirSync(path.join(this.dataDir, sub), { recursive: true });
      }
    } catch (err) {
      throw new AppError('WORKTREE_SETUP', `dataDir 不可写，无法创建 worktree：${(err as Error).message}`);
    }
    if (!existsSync(this.repoPath)) {
      throw new AppError('WORKTREE_SETUP', `目标仓不存在：${this.repoPath}`);
    }
    try {
      git(this.repoPath, ['rev-parse', '--git-dir']);
    } catch (err) {
      throw new AppError('WORKTREE_SETUP', `目标仓不可访问或不是 git 仓库：${(err as Error).message}`);
    }
  }

  /** 目标仓默认分支 HEAD（基线；S2a 简化：一律 repo 默认分支 HEAD） */
  defaultBranchHead(): string {
    try {
      const remoteRef = execFileSync(
        'git',
        ['-C', this.repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { encoding: 'utf8' },
      ).trim();
      return git(this.repoPath, ['rev-parse', remoteRef]).trim();
    } catch {
      for (const candidate of ['main', 'master']) {
        try {
          return git(this.repoPath, ['rev-parse', `refs/heads/${candidate}`]).trim();
        } catch {
          // 尝试下一候选
        }
      }
    }
    throw new AppError('WORKTREE_SETUP', `无法确定目标仓默认分支：${this.repoPath}`);
  }

  /**
   * 分配 worktree：已存在同名单则复用（改派/继续/重试场景，分支与半成品保留）；
   * 分支已存在（回收时留了分支）则挂回；否则从基线新建分支。返回 worktree 路径。
   */
  allocate(ticketId: number): string {
    const wtPath = this.pathFor(ticketId);
    const branch = this.branchFor(ticketId);
    // 清理指向已消失目录的陈旧元数据（幂等）
    try {
      git(this.repoPath, ['worktree', 'prune']);
    } catch {
      // prune 失败不阻断（后续 add 自会暴露问题）
    }
    if (existsSync(wtPath)) return wtPath;

    let branchExists = false;
    try {
      git(this.repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      branchExists = true;
    } catch {
      branchExists = false;
    }
    if (branchExists) {
      git(this.repoPath, ['worktree', 'add', wtPath, branch]);
    } else {
      git(this.repoPath, ['worktree', 'add', '-b', branch, wtPath, this.defaultBranchHead()]);
    }
    return wtPath;
  }

  /** worktree 当前 HEAD（每轮 spawn 前的基线） */
  baseline(wtPath: string): string {
    return git(wtPath, ['rev-parse', 'HEAD']).trim();
  }

  /**
   * 回收：keepBranch=true（默认）删 worktree 目录、留 atd/t{id} 分支与 commit；
   * false 时连分支删（commit 关联已落库不受影响）。目录有未提交内容时强制移除。
   */
  reclaim(ticketId: number, keepBranch: boolean): void {
    const wtPath = this.pathFor(ticketId);
    const branch = this.branchFor(ticketId);
    if (existsSync(wtPath)) {
      try {
        git(this.repoPath, ['worktree', 'remove', wtPath]);
      } catch {
        git(this.repoPath, ['worktree', 'remove', '--force', wtPath]);
      }
    } else {
      try {
        git(this.repoPath, ['worktree', 'prune']);
      } catch {
        // 幂等清理，失败忽略
      }
    }
    if (!keepBranch) {
      try {
        git(this.repoPath, ['branch', '-D', branch]);
      } catch {
        // 分支不存在（从未执行过）时静默
      }
    }
  }
}
