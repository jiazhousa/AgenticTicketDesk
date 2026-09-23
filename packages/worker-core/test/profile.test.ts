import { describe, expect, test } from 'vitest';
import { validateProfile, type WorkerProfile } from '../src/profile.js';

/** 合法 profile 模板（与预置 opencode.yaml 同构） */
const LEGAL = [
  'id: fake',
  'name: Fake',
  'protocol: spawn-cli',
  'capabilities: [task]',
  'command: opencode run --standalone --format json {{prompt}}',
  'timeoutMin: 30',
].join('\n');

describe('WorkerProfile 注册防护【B7】', () => {
  test('合法 profile 通过校验并返回解析结果', () => {
    const p = validateProfile(LEGAL, 'legal.yaml');
    expect(p).toMatchObject({ id: 'fake', protocol: 'spawn-cli', timeoutMin: 30 });
    expect(p.capabilities).toEqual(['task']);
  });

  test('命令含 git push → 拒绝且报错可读', () => {
    const yaml = LEGAL.replace(
      'command: opencode run --format json --dir {{worktree}} {{prompt}}',
      'command: git push origin main',
    );
    expect(() => validateProfile(yaml, 'push.yaml')).toThrowError(/push/);
  });

  test('命令含 remote → 拒绝（推送类 token 全集拦截）', () => {
    const yaml = LEGAL.replace(
      'command: opencode run --format json --dir {{worktree}} {{prompt}}',
      'command: git remote -v',
    );
    expect(() => validateProfile(yaml, 'remote.yaml')).toThrowError(/remote/);
  });

  test('含 sk- 前缀疑似 key → 拒绝且报错可读', () => {
    const yaml = LEGAL.replace('timeoutMin: 30', 'timeoutMin: 30\napiKey: sk-abc123def456');
    expect(() => validateProfile(yaml, 'sk.yaml')).toThrowError(/sk-/);
  });

  test('含 32 位以上连续随机串 → 拒绝（凭据特征兜底）', () => {
    const yaml = LEGAL.replace(
      'command: opencode run --format json --dir {{worktree}} {{prompt}}',
      'command: mycli --token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(() => validateProfile(yaml, 'long.yaml')).toThrowError(/凭据/);
  });

  test('schema 缺字段 → 拒绝且报错含字段名', () => {
    const yaml = LEGAL.replace('\nprotocol: spawn-cli', '');
    expect(() => validateProfile(yaml, 'missing.yaml')).toThrowError(/protocol/);
  });

  test('协议不识别（非 spawn-cli）→ 拒绝', () => {
    const yaml = LEGAL.replace('protocol: spawn-cli', 'protocol: http');
    expect(() => validateProfile(yaml, 'proto.yaml')).toThrowError(/protocol/);
  });
});
