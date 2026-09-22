/**
 * 时间戳（毫秒）格式化工具。
 */
/** 毫秒时间戳 → `YYYY-MM-DD HH:mm` 本地时间 */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
