/**
 * 单行 JSONL 解析：仅接受以 { 或 [ 开头且可整体 JSON.parse 的行，其余跳过（计数留痕）。
 */
export type ParsedLine = { kind: 'json'; value: unknown } | { kind: 'skipped' };

export function parseLine(line: string): ParsedLine {
  const t = line.trim();
  if (!t) return { kind: 'skipped' };
  if (!t.startsWith('{') && !t.startsWith('[')) return { kind: 'skipped' };
  try {
    return { kind: 'json', value: JSON.parse(t) };
  } catch {
    return { kind: 'skipped' };
  }
}
