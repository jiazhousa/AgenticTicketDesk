import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../app.js';
import { AppError } from '../domain/errors.js';
import type { Workspace } from '../workspaces.js';

/** 视图形态：repos 含解析后绝对路径 + 主仓 id + 工单计数（契约 §3） */
function toInfo(ws: Workspace, ticketCount: number) {
  return {
    id: ws.id,
    name: ws.name,
    repos: ws.repos.map((r) => ({ id: r.id, path: r.path, role: r.role })),
    primary: ws.primary,
    ticketCount,
  };
}

/** workspace 查询路由（只读来源：声明变更改 yaml 重启生效，不经 API 增删改） */
export function registerWorkspaceRoutes(app: FastifyInstance, runtime?: AppRuntime): void {
  // GET /api/workspaces —— 列表（含 repos 明细、主仓标识、工单计数）
  app.get('/api/workspaces', async () => {
    const counts = runtime?.service.countByWorkspace() ?? new Map<string, number>();
    return {
      workspaces: (runtime?.workspaces.list() ?? []).map((ws) => toInfo(ws, counts.get(ws.id) ?? 0)),
    };
  });

  // GET /api/workspaces/:id —— 详情（未知 id → 404）
  app.get('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    const ws = runtime?.workspaces.get(id);
    if (!ws) {
      throw new AppError('NOT_FOUND', `workspace 不存在：${id}`);
    }
    const counts = runtime?.service.countByWorkspace() ?? new Map<string, number>();
    return { workspace: toInfo(ws, counts.get(ws.id) ?? 0) };
  });
}
