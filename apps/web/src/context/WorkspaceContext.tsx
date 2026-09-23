import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** localStorage 持久化 key：值为 workspace id，'all' 哨兵表达「全部」视图 */
const STORAGE_KEY = 'atd-workspace';
/** 「全部」视图哨兵（Context 态以 null 表达，存储层以该字符串表达） */
const ALL_VALUE = 'all';

type WorkspaceContextValue = {
  /** 当前所选 workspace id；null=「全部」视图（列表请求不传过滤参数=全量） */
  workspaceId: string | null;
  /** 切换所选 workspace（null=全部）；同步写 localStorage 持久化 */
  setWorkspaceId: (id: string | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** 读取持久化的所选 workspace（无记录/解析异常 → null=全部；'all' 哨兵归一为 null） */
function readStoredWorkspaceId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null || v === ALL_VALUE ? null : v;
  } catch {
    // localStorage 不可用（隐私模式等）——退化为不持久化
    return null;
  }
}

/**
 * 当前 workspace 全局态 Provider（顶栏切换器写、三页列表读）。
 * 仅持有所选 id，不拉数据——workspace 列表数据走 utils/workspace.ts 的索引缓存。
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(readStoredWorkspaceId);

  const setWorkspaceId = useCallback((id: string | null) => {
    setWorkspaceIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id ?? ALL_VALUE);
    } catch {
      // 持久化失败不影响会话内切换
    }
  }, []);

  return <WorkspaceContext.Provider value={{ workspaceId, setWorkspaceId }}>{children}</WorkspaceContext.Provider>;
}

/** 读取当前 workspace 全局态（须在 WorkspaceProvider 内使用） */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (ctx == null) {
    throw new Error('useWorkspace 必须在 WorkspaceProvider 内使用');
  }
  return ctx;
}
