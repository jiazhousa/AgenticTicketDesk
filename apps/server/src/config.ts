import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** dataDir 下四个 S2a 产物子目录（DB 留在 apps/server/data） */
export const DATA_SUBDIRS = ['worktrees', 'logs', 'prompts', 'runtime'] as const;

const configSchema = z.object({
  /**
   * 目标仓路径（相对路径以 config.yaml 所在 repo 根为基准）。
   * S2w1 起不再参与装配——主仓声明唯一来源=workspaces/*.yaml（atd.yaml）；
   * 字段保留 optional 兼容既有 config.yaml，读取方为零。
   */
  repoPath: z.string().min(1).optional(),
  /** S2a 产物根目录（~ 展开），默认 ~/.local/share/atd */
  dataDir: z.string().min(1).default('~/.local/share/atd'),
  /** 默认单轮执行超时（分钟）；profile 自带 timeoutMin 时以 profile 为准 */
  defaultTimeoutMin: z.number().int().positive().default(60),
  /** 报告缺失/格式错误重试次数（L2） */
  retryOnReportMiss: z.number().int().min(0).default(1),
});

export type AppConfig = z.infer<typeof configSchema>;

/** ~ 展开为用户主目录 */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * 加载项目根 config.yaml：缺失报错（启动即失败）；相对路径以 repoRoot 为基准；
 * dataDir 四个子目录在此建齐（启动期快速失败，运行期 worktree 前置校验复用同逻辑）。
 */
export function loadConfig(repoRoot: string): AppConfig {
  const file = path.join(repoRoot, 'config.yaml');
  if (!existsSync(file)) {
    throw new Error(`config.yaml 缺失：${file}`);
  }
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`config.yaml 解析失败：${(err as Error).message}`);
  }
  const parsed = configSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`config.yaml 校验失败：${issues.join('；')}`);
  }
  const cfg = parsed.data;
  const resolved: AppConfig = {
    ...cfg,
    repoPath: cfg.repoPath != null ? path.resolve(repoRoot, expandHome(cfg.repoPath)) : undefined,
    dataDir: path.resolve(expandHome(cfg.dataDir)),
  };
  for (const sub of DATA_SUBDIRS) {
    mkdirSync(path.join(resolved.dataDir, sub), { recursive: true });
  }
  return resolved;
}
