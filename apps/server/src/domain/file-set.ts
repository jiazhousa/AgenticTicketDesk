/**
 * 文件集匹配单一实现（双向复用：声明 vs 声明、实测 vs 声明）。
 * 语义：条目为相对 repoRef 路径；精确路径匹配；尾斜杠（`dir/`）= 目录递归包含。
 * 不做 glob/通配（S3 范围外）；空集/未声明（null）由调用方跳过，本模块只处理非空 string[]。
 */

/** 单条目是否命中路径：相等，或条目为目录前缀且路径落于其下 */
function entryMatches(entry: string, path: string): boolean {
  if (entry === path) return true;
  if (entry.endsWith('/')) return path.startsWith(entry);
  return false;
}

/** 两文件集的相交条目（双方任一条目互相命中即计入，命中对两侧条目都收录；去重保序） */
export function intersectingPaths(a: string[], b: string[]): string[] {
  const hits = new Set<string>();
  for (const ea of a) {
    for (const eb of b) {
      if (entryMatches(ea, eb) || entryMatches(eb, ea)) {
        hits.add(ea);
        hits.add(eb);
      }
    }
  }
  return [...hits];
}

/** 两文件集是否相交（intersectingPaths 的布尔捷径） */
export function intersects(a: string[], b: string[]): boolean {
  for (const ea of a) {
    for (const eb of b) {
      if (entryMatches(ea, eb) || entryMatches(eb, ea)) return true;
    }
  }
  return false;
}
