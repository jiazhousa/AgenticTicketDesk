import { describe, expect, test } from 'vitest';
import { intersectingPaths, intersects } from '../src/domain/file-set.js';

/** 匹配边界锁定：精确路径 + 目录前缀（尾斜杠递归）；匹配函数单实现双向复用 */
describe('文件集匹配【S3】', () => {
  test('精确路径：相等相交，前后缀扩展名不相交', () => {
    expect(intersects(['src/a.ts'], ['src/a.ts'])).toBe(true);
    expect(intersects(['src/a.ts'], ['src/a.tsx'])).toBe(false);
    expect(intersects(['a.ts'], ['dir/a.ts'])).toBe(false);
  });

  test('目录前缀：`dir/` 递归包含其下任意深度路径', () => {
    expect(intersects(['src/'], ['src/a.ts'])).toBe(true);
    expect(intersects(['src/'], ['src/sub/deep/a.ts'])).toBe(true);
    expect(intersects(['src/'], ['srcx/a.ts'])).toBe(false);
  });

  test('无尾斜杠条目不递归：`dir` 仅精确匹配自身路径', () => {
    expect(intersects(['src'], ['src'])).toBe(true);
    expect(intersects(['src'], ['src/a.ts'])).toBe(false);
  });

  test('嵌套目录：父目录条目与子目录条目相交（双向）', () => {
    expect(intersects(['src/'], ['src/sub/'])).toBe(true);
    expect(intersects(['src/sub/'], ['src/'])).toBe(true);
    expect(intersects(['src/sub/'], ['lib/'])).toBe(false);
  });

  test('根级路径（无目录段）精确匹配', () => {
    expect(intersects(['README.md'], ['README.md'])).toBe(true);
    expect(intersects(['README.md'], ['docs/README.md'])).toBe(false);
  });

  test('双向性：文件 vs 目录两侧互换仍命中', () => {
    expect(intersects(['src/a.ts'], ['src/'])).toBe(true);
    expect(intersects(['src/'], ['src/a.ts'])).toBe(true);
  });

  test('空集恒不相交（未声明跳过语义）', () => {
    expect(intersects([], ['src/'])).toBe(false);
    expect(intersects(['src/'], [])).toBe(false);
    expect(intersects([], [])).toBe(false);
  });

  test('intersectingPaths 返回命中对两侧条目（去重保序，供错误 details 与预警文案）', () => {
    expect(intersectingPaths(['src/a.ts', 'lib/x.ts'], ['src/'])).toEqual(['src/a.ts', 'src/']);
    expect(intersectingPaths(['src/'], ['src/a.ts', 'src/b.ts'])).toEqual(['src/', 'src/a.ts', 'src/b.ts']);
    expect(intersectingPaths(['a.ts'], ['b.ts'])).toEqual([]);
  });
});
