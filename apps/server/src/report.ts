import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** 完成报告 schema（worker 在 worktree 根写 atd-report.json；可选字段均收 null——JSON 直觉写法） */
const atdReportSchema = z
  .object({
    status: z.enum(['done', 'blocked']),
    summary: z.string().min(1),
    /** 报告声明 commits 仅作交叉校验，落库以 git 实测为准 */
    commits: z.array(z.string()).nullable().optional(),
    blockReason: z.string().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'blocked' && !(v.blockReason ?? '').trim()) {
      ctx.addIssue({ code: 'custom', message: 'blocked 状态必须提供 blockReason' });
    }
  });

export type AtdReport = z.infer<typeof atdReportSchema>;

export type ReportRead = { ok: true; report: AtdReport } | { ok: false; reason: string };

/** 读取并校验 worktree 根的 atd-report.json（进程正常结束后调用） */
export function readReport(worktreePath: string): ReportRead {
  const file = path.join(worktreePath, 'atd-report.json');
  if (!existsSync(file)) return { ok: false, reason: 'missing' };
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `json 解析失败：${(err as Error).message}` };
  }
  const parsed = atdReportSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, reason: `schema 校验失败：${issues.join('；')}` };
  }
  return { ok: true, report: parsed.data };
}

/** 该轮新增 commits：git log 基线 diff（以 git 实测为准；报告 commits 仅交叉校验） */
export function listNewCommits(worktreePath: string, baseline: string): string[] {
  const out = execFileSync('git', ['-C', worktreePath, 'log', '--format=%H', `${baseline}..HEAD`], {
    encoding: 'utf8',
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}
