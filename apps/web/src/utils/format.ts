/**
 * 时间戳（毫秒）格式化工具。
 */
/** 毫秒时间戳 → `YYYY-MM-DD HH:mm` 本地时间 */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 毫秒时间戳 → `HH:mm:ss` 本地时间（日志行内时间标注用） */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 时长（毫秒）→ 人类可读：`38秒` / `5分12秒` / `1时03分` / `2天3时`（执行耗时展示用） */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const s = sec % 60;
    return s > 0 ? `${min}分${s}秒` : `${min}分`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    const m = min % 60;
    return m > 0 ? `${hour}时${String(m).padStart(2, '0')}分` : `${hour}时`;
  }
  const day = Math.floor(hour / 24);
  return `${day}天${hour % 24}时`;
}
