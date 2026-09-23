import { useEffect, useState } from 'react';
import { listWorkspaces } from '../api/tickets';
import type { Workspace } from '../api/types';

/** 模块级索引缓存：一次会话内所有消费方共享同一请求（yaml 静态声明，改配置重启后端+刷新页面自然重拉） */
let cachedPromise: Promise<Map<string, Workspace>> | null = null;

function fetchWorkspaceMap(): Promise<Map<string, Workspace>> {
  if (cachedPromise == null) {
    cachedPromise = listWorkspaces()
      .then((list) => new Map(list.map((w) => [w.id, w])))
      .catch((err) => {
        // 失败不缓存，下次挂载重试（失败 toast 已由 api 层弹出）
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}

/**
 * workspace 索引 hook（顶栏切换器数据源 / repoRef 主仓判定）。
 * workspace 数量为 yaml 声明的几十条以内，直查即可。
 * 返回 null=加载中或失败（失败降级：主仓判定按「显示 repoRef 本身」处理）。
 */
export function useWorkspaceMap(): Map<string, Workspace> | null {
  const [map, setMap] = useState<Map<string, Workspace> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchWorkspaceMap()
      .then((m) => {
        if (alive) setMap(m);
      })
      .catch(() => {
        // 保持 null：消费方按降级逻辑展示
      });
    return () => {
      alive = false;
    };
  }, []);

  return map;
}
