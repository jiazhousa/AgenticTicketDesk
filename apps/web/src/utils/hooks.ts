import { useEffect, useRef, useState } from 'react';

/**
 * 周期轮询 hook：页面隐藏（document 不可见）时跳过回调，避免后台页空转请求。
 * cb 引用变化不重置计时器（以 ref 持有），间隔变化时重建。
 */
export function useInterval(cb: () => void, intervalMs: number | null): void {
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  }, [cb]);

  useEffect(() => {
    if (intervalMs == null) return;
    const timer = setInterval(() => {
      // 页面不可见时跳过本轮（回到可见后由下一周期自然补齐）
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      cbRef.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}

/** 每秒跳动的当前时刻（运行中耗时实时展示用）；enabled=false 时静止以省渲染 */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
