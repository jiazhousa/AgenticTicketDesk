import { describe, expect, test } from 'vitest';
import { PERM_BASH_RULES, buildPermConfig, buildPermJson } from '../src/perm-config.js';

/** MUST-2 权限注入规则集逐条断言（B9 专属锚点） */
describe('perm-config：注入规则集内容', () => {
  test('bash 规则集逐条：catch-all allow（无人值守）+ push/remote/PR 后置 deny 覆盖', () => {
    expect(PERM_BASH_RULES).toEqual({
      '*': 'allow',
      'git push': 'deny',
      'git push *': 'deny',
      'git remote *': 'deny',
      'gh *pr*create*': 'deny',
    });
  });

  test('buildPermJson 输出对象形态：顶层 permission.bash 含 git push deny 条目', () => {
    const raw = buildPermJson();
    expect(raw).toContain('"permission"');
    expect(raw).toContain('"bash"');
    expect(raw).toContain('"git push":"deny"');
    expect(raw).toContain('"git push *":"deny"');
    expect(raw).toContain('"git remote *":"deny"');
    expect(raw).toContain('"gh *pr*create*":"deny"');
    const parsed = JSON.parse(raw) as ReturnType<typeof buildPermConfig>;
    expect(parsed).toEqual(buildPermConfig());
    expect(parsed.permission.bash['git push']).toBe('deny');
  });

  test('buildPermConfig 返回副本（防外部篡改常量）', () => {
    const a = buildPermConfig();
    a.permission.bash['*'] = 'tampered';
    expect(buildPermConfig().permission.bash['*']).toBe('allow');
  });
});
