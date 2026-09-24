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
 * 多仓参数化（D1）：目标仓路径由调用方逐次传入（按工单 workspace+repoRef 解析），manager 不持仓状态。
 */
export class WorktreeManager {
  constructor(private readonly dataDir: string) {}

  /** dataDir 下 worktrees 根目录（自治领地边界：领地内孤儿挂载可自动回收） */
  private get worktreesRoot(): string {
    return path.join(this.dataDir, 'worktrees');
  }

  /** 工单 worktree 路径（不校验存在性）；目录名=目标仓 basename + workspaceId 维度消歧 */
  pathFor(workspaceId: string, ticketId: number, repoPath: string): string {
    const repoName = path.basename(path.resolve(repoPath));
    return path.join(this.dataDir, 'worktrees', `${repoName}-${workspaceId}-t${ticketId}`);
  }

  /** 工单分支名（workspaceId 维度消歧：跨 workspace 同仓/历史残留天然不撞） */
  branchFor(workspaceId: string, ticketId: number): string {
    return `atd/${workspaceId}-t${ticketId}`;
  }

  /**
   * 前置可建性校验（放行四件套之 worktree 项）：dataDir 四子目录可写 + 目标仓可访问且为 git 仓。
   * 失败抛 WORKTREE_SETUP。
   */
  assertReady(repoPath: string): void {
    try {
      for (const sub of DATA_SUBDIRS) {
        mkdirSync(path.join(this.dataDir, sub), { recursive: true });
      }
    } catch (err) {
      throw new AppError('WORKTREE_SETUP', `dataDir 不可写，无法创建 worktree：${(err as Error).message}`);
    }
    if (!existsSync(repoPath)) {
      throw new AppError('WORKTREE_SETUP', `目标仓不存在：${repoPath}`);
    }
    try {
      git(repoPath, ['rev-parse', '--git-dir']);
    } catch (err) {
      throw new AppError('WORKTREE_SETUP', `目标仓不可访问或不是 git 仓库：${(err as Error).message}`);
    }
  }

  /** 目标仓默认分支 HEAD（基线；S2a 简化：一律 repo 默认分支 HEAD） */
  defaultBranchHead(repoPath: string): string {
    try {
      const remoteRef = execFileSync(
        'git',
        ['-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { encoding: 'utf8' },
      ).trim();
      return git(repoPath, ['rev-parse', remoteRef]).trim();
    } catch {
      for (const candidate of ['main', 'master']) {
        try {
          return git(repoPath, ['rev-parse', `refs/heads/${candidate}`]).trim();
        } catch {
          // 尝试下一候选
        }
      }
    }
    throw new AppError('WORKTREE_SETUP', `无法确定目标仓默认分支：${repoPath}`);
  }

  /**
   * 分配 worktree：已存在同名单则复用（改派/继续/重试场景，分支与半成品保留）；
   * 分支已存在（回收时留了分支）则挂回——若分支被其他 worktree 挂载占用，
   * dataDir 自治领地内的孤儿挂载（终态单/死实例遗留）自动回收，外部占用报错指引。返回 worktree 路径。
   */
  allocate(workspaceId: string, ticketId: number, repoPath: string): string {
    const wtPath = this.pathFor(workspaceId, ticketId, repoPath);
    const branch = this.branchFor(workspaceId, ticketId);
    // 清理指向已消失目录的陈旧元数据（幂等）
    try {
      git(repoPath, ['worktree', 'prune']);
    } catch {
      // prune 失败不阻断（后续 add 自会暴露问题）
    }
    if (existsSync(wtPath)) return wtPath;

    let branchExists = false;
    try {
      git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      branchExists = true;
    } catch {
      branchExists = false;
    }
    if (branchExists) {
      const holder = this.branchHolder(repoPath, branch);
      if (holder && !holder.startsWith(this.worktreesRoot)) {
        throw new AppError(
          'WORKTREE_SETUP',
          `分支 ${branch} 被外部 worktree 占用：${holder}（非本 dataDir 管理范围，请手动处理）`,
        );
      }
      if (holder) {
        // 领地内孤儿挂载：终态单/死实例遗留（其内容已无归属），强制回收释放分支
        git(repoPath, ['worktree', 'remove', '--force', holder]);
      }
      git(repoPath, ['worktree', 'add', wtPath, branch]);
    } else {
      git(repoPath, ['worktree', 'add', '-b', branch, wtPath, this.defaultBranchHead(repoPath)]);
    }
    return wtPath;
  }

  /** 分支被哪个 worktree 挂载（checkout）；未被挂载返回 null。 */
  private branchHolder(repoPath: string, branch: string): string | null {
    const out = git(repoPath, ['worktree', 'list', '--porcelain']);
    let current: string | null = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
      if (current && line === `branch refs/heads/${branch}`) return current;
    }
    return null;
  }

  /** worktree 当前 HEAD（每轮 spawn 前的基线） */
  baseline(wtPath: string): string {
    return git(wtPath, ['rev-parse', 'HEAD']).trim();
  }

  /**
   * 回收：keepBranch=true（默认）删 worktree 目录、留 atd/{ws}-t{id} 分支与 commit；
   * false 时连分支删（commit 关联已落库不受影响）。目录有未提交内容时强制移除。
   */
  reclaim(workspaceId: string, ticketId: number, repoPath: string, keepBranch: boolean): void {
    const wtPath = this.pathFor(workspaceId, ticketId, repoPath);
    const branch = this.branchFor(workspaceId, ticketId);
    if (existsSync(wtPath)) {
      try {
        git(repoPath, ['worktree', 'remove', wtPath]);
      } catch {
        git(repoPath, ['worktree', 'remove', '--force', wtPath]);
      }
    } else {
      try {
        git(repoPath, ['worktree', 'prune']);
      } catch {
        // 幂等清理，失败忽略
      }
    }
    if (!keepBranch) {
      try {
        git(repoPath, ['branch', '-D', branch]);
      } catch {
        // 分支不存在（从未执行过）时静默
      }
    }
  }
}
