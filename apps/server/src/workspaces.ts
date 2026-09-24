import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** workspace 内的仓声明（path 为加载期解析后的绝对路径） */
export type WorkspaceRepo = { id: string; path: string; role: 'primary' | 'readable' };

/** workspace 聚合：primary 为主仓 repo id（每 workspace 恰一个） */
export type Workspace = { id: string; name: string; repos: WorkspaceRepo[]; primary: string };

/** kebab-case（小写字母/数字/连字符段） */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const repoSchema = z.object({
  id: z.string().regex(KEBAB_CASE, 'repo id 须为 kebab-case（小写字母/数字/连字符）'),
  path: z.string().min(1),
  role: z.enum(['primary', 'readable']),
});

const workspaceSchema = z.object({
  id: z.string().regex(KEBAB_CASE, 'workspace id 须为 kebab-case（小写字母/数字/连字符）'),
  name: z.string().min(1),
  repos: z.array(repoSchema).min(1),
});

/** ~ 展开为用户主目录（与 config.yaml 同规则） */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * workspace 注册表：加载/持有/查询声明式 workspace（workspaces/*.yaml）。
 * 只读来源：不经 API 增删改（改 yaml 重启生效，不做热更新）。
 */
export class WorkspaceRegistry {
  private readonly byId = new Map<string, Workspace>();

  /** 注册单个 workspace；workspace id 重复 / workspace 内 repo id 重复抛错 */
  register(ws: Workspace): void {
    if (this.byId.has(ws.id)) {
      throw new Error(`workspace id 重复：${ws.id}`);
    }
    const repoIds = new Set<string>();
    for (const r of ws.repos) {
      if (repoIds.has(r.id)) {
        throw new Error(`workspace ${ws.id} 内 repo id 重复：${r.id}`);
      }
      repoIds.add(r.id);
    }
    this.byId.set(ws.id, ws);
  }

  list(): Workspace[] {
    return [...this.byId.values()];
  }

  get(id: string): Workspace | undefined {
    return this.byId.get(id);
  }

  /**
   * 解析仓绝对路径：workspace 未知或 repoRef ∉ repos（缺省=主仓）时返回 null。
   * 不抛错——建单期（REPO_REF_INVALID）与放行期（REPO_REF_DRIFTED）的错误语义由调用方决定。
   */
  resolveRepoPath(workspaceId: string, repoRef: string | null | undefined): string | null {
    const ws = this.byId.get(workspaceId);
    if (!ws) return null;
    const ref = repoRef ?? ws.primary;
    return ws.repos.find((r) => r.id === ref)?.path ?? null;
  }
}

/**
 * 加载 repoRoot 下 workspaces/*.yaml 为注册表。
 * 无目录/无声明/解析或校验失败 → 抛错（启动即失败，本地系统快速失败，不做兜底合成），
 * 错误信息含文件名与具体原因。
 */
export function loadWorkspaces(repoRoot: string): WorkspaceRegistry {
  const dir = path.join(repoRoot, 'workspaces');
  if (!existsSync(dir)) {
    throw new Error(`workspaces 目录缺失：${dir}——请参照仓内 workspaces/atd.yaml 模板创建（本地系统不做兜底合成）`);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  if (files.length === 0) {
    throw new Error(`workspaces 目录为空：${dir}——请参照仓内 workspaces/atd.yaml 模板创建（本地系统不做兜底合成）`);
  }
  const registry = new WorkspaceRegistry();
  for (const file of files) {
    const full = path.join(dir, file);
    let doc: unknown;
    try {
      doc = parseYaml(readFileSync(full, 'utf8'));
    } catch (err) {
      throw new Error(`workspaces/${file} 解析失败：${(err as Error).message}`);
    }
    const parsed = workspaceSchema.safeParse(doc);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      throw new Error(`workspaces/${file} 校验失败：${issues.join('；')}`);
    }
    // path 解析基准=repoRoot（相对）或 ~ 展开（与 config.yaml 同规则）
    const repos: WorkspaceRepo[] = parsed.data.repos.map((r) => ({
      ...r,
      path: path.resolve(repoRoot, expandHome(r.path)),
    }));
    for (const r of repos) {
      if (!existsSync(r.path)) {
        throw new Error(`workspaces/${file} 声明的仓路径不存在：repo=${r.id} path=${r.path}`);
      }
    }
    const primaries = repos.filter((r) => r.role === 'primary');
    if (primaries.length !== 1) {
      throw new Error(`workspaces/${file} 主仓（role=primary）必须恰有一个，当前 ${primaries.length} 个`);
    }
    try {
      registry.register({ id: parsed.data.id, name: parsed.data.name, repos, primary: primaries[0].id });
    } catch (err) {
      throw new Error(`workspaces/${file}：${(err as Error).message}`);
    }
  }
  return registry;
}
