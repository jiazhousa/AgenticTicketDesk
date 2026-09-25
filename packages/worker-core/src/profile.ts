import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** interactive 模式 serve 命令缺省模板（MVP 单 serve：opencode 形态） */
export const DEFAULT_SERVE_COMMAND = 'opencode serve --port {port}';

/**
 * WorkerProfile schema（workers/*.yaml 的唯一事实源）。
 * task 模式=spawn-cli 单轮执行；interactive 模式=常驻 serve 长会话（S2b1）。
 */
export const workerProfileSchema = z.object({
  /** 唯一标识（小写字母/数字/连字符） */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 仅允许小写字母、数字与连字符'),
  /** 展示名 */
  name: z.string().min(1),
  protocol: z.literal('spawn-cli'),
  capabilities: z.array(z.enum(['task', 'interactive'])).min(1),
  /** 命令模板：{{worktree}} / {{prompt}} 由编排层以参数数组整体替换（不经 shell，无注入面） */
  command: z.string().min(1),
  /** 单轮执行超时（分钟），超时杀进程树 */
  timeoutMin: z.number().int().positive().optional(),
  /**
   * interactive 模式声明段（capabilities 含 interactive 时生效）。
   * serveCommand 为 serve 子进程命令模板，{port} 由编排层整体替换（不经 shell）；
   * yaml 裸键（interactive:）解析为 null，视同声明段存在但全缺省。
   */
  interactive: z
    .preprocess(
      (v) => (v === null ? {} : v),
      z.object({
        serveCommand: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

export type WorkerProfile = z.infer<typeof workerProfileSchema>;

/** 推送类 token（MUST-3）：模板中出现即拒绝注册——worker 侧无 push 通道 */
const PUSH_TOKEN_RE = /\b(push|remote)\b/i;

/** 凭据特征（MUST-6）：常见 token 前缀（词边界锚定，需后随键内容）或 32 位以上连续随机串 */
const CREDENTIAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsk-[A-Za-z0-9_-]{8,}/, label: '疑似 OpenAI/兼容网关 key（sk- 前缀）' },
  { re: /\bglpat-[A-Za-z0-9_-]{8,}/, label: '疑似 GitLab token（glpat- 前缀）' },
  { re: /\bghp_[A-Za-z0-9]{8,}/, label: '疑似 GitHub token（ghp_ 前缀）' },
  { re: /\bxoxb-[A-Za-z0-9-]{8,}/, label: '疑似 Slack token（xoxb- 前缀）' },
  { re: /[A-Za-z0-9_-]{32,}/, label: '疑似随机凭据串（32 位以上连续 [A-Za-z0-9_-]）' },
];

/** 凭据扫描：对 yaml 原文整文扫描（覆盖全部键值，最稳） */
function scanCredentials(raw: string): void {
  for (const { re, label } of CREDENTIAL_PATTERNS) {
    const hit = raw.match(re);
    if (hit) {
      throw new Error(`profile 含疑似凭据，拒绝注册：${label}（命中片段：${hit[0].slice(0, 12)}…）`);
    }
  }
}

/**
 * 校验单个 profile 文件内容：凭据扫描（原文）→ yaml 解析 → schema → 推送 token 校验。
 * 任一失败抛出可读错误（注册即拒绝）。
 */
export function validateProfile(raw: string, source: string): WorkerProfile {
  scanCredentials(raw);

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(`profile YAML 解析失败（${source}）：${(err as Error).message}`);
  }

  const parsed = workerProfileSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`profile schema 校验失败（${source}）：${issues.join('；')}`);
  }
  const profile = parsed.data;

  if (PUSH_TOKEN_RE.test(profile.command)) {
    throw new Error(
      `profile 命令模板含推送类 token（push/remote），拒绝注册（${source}）：${profile.command}`,
    );
  }
  const serveCommand = profile.interactive?.serveCommand ?? DEFAULT_SERVE_COMMAND;
  if (!serveCommand.includes('{port}')) {
    throw new Error(`profile interactive.serveCommand 必须含 {port} 占位符（${source}）：${serveCommand}`);
  }
  return profile;
}

/**
 * interactive 能力可用性判定：MVP 单 serve 仅支持 opencode serve 形态——
 * 声明了 interactive 但 serveCommand 非 opencode serve 形态的 worker 标记不可用
 * （聊天框建会话下拉不列出）。task 模式不受影响。
 */
export function isInteractiveServeCompatible(profile: WorkerProfile): boolean {
  if (!profile.capabilities.includes('interactive')) return false;
  const tokens = (profile.interactive?.serveCommand ?? DEFAULT_SERVE_COMMAND).trim().split(/\s+/);
  return tokens[0] === 'opencode' && tokens[1] === 'serve';
}

/**
 * 渲染 serve 命令为参数数组：按空白拆 token 后整体替换 {port}——
 * 端口值不二次拆分（参数数组语义，不经 shell，无注入面）。
 */
export function renderServeCommand(profile: WorkerProfile, port: number): string[] {
  const template = profile.interactive?.serveCommand ?? DEFAULT_SERVE_COMMAND;
  return template
    .trim()
    .split(/\s+/)
    .map((token) => token.replaceAll('{port}', String(port)));
}
