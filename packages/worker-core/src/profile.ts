import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * WorkerProfile schema（workers/*.yaml 的唯一事实源）。
 * S2a 仅实现 spawn-cli 协议的 task 模式；interactive 随后续版本接入。
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
  return profile;
}
