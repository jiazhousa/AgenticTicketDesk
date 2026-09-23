/**
 * MUST-2 宿主侧权限收口：注入 opencode 的 permission 规则集（对象形态，catch-all 在前、
 * last-match-wins）。task worker 无人值守：bash 全放行但推送类后置 deny 覆盖；edit/write 放行
 * （worktree 内作业）。仅约束经 opencode 工具层的操作；profile 直跑外部命令不经该层，
 * 由 MUST-3 模板校验与 profile 人工审查兜底（适用边界如实记录于 spec B9）。
 */
export const PERM_BASH_RULES: Record<string, string> = {
  '*': 'allow',
  'git push': 'deny',
  'git push *': 'deny',
  'git remote *': 'deny',
  'gh *pr*create*': 'deny',
};

/** 注入配置对象（OPENCODE_CONFIG_CONTENT 的内联 JSON 内容） */
export function buildPermConfig(): {
  permission: { bash: Record<string, string>; edit: string; write: string };
} {
  return { permission: { bash: { ...PERM_BASH_RULES }, edit: 'allow', write: 'allow' } };
}

/** 注入配置 JSON 字符串（主通道 OPENCODE_CONFIG_CONTENT；fallback 通道写文件同内容） */
export function buildPermJson(): string {
  return JSON.stringify(buildPermConfig());
}
