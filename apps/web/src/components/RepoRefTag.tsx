import { Tag } from 'antd';
import type { Ticket, Workspace } from '../api/types';

/**
 * 判定目标仓显示名：TASK 单 repoRef 非主仓时返回仓名，其余（主仓/非 TASK/无仓语义）返回 null（省略）。
 * workspaceMap 为 null（索引未就绪/失败）或查无该 workspace 时保守返回 repoRef 本身——
 * 宁可多显示也不把跨仓单误判为主仓吞掉标记。
 */
export function resolveRepoRefLabel(
  ticket: Pick<Ticket, 'type' | 'repoRef' | 'workspaceId'>,
  workspaceMap: Map<string, Workspace> | null,
): string | null {
  if (ticket.type !== 'TASK' || ticket.repoRef == null) return null;
  const ws = workspaceMap?.get(ticket.workspaceId);
  if (ws != null && ticket.repoRef === ws.primary) return null;
  return ticket.repoRef;
}

/** 目标仓 Tag：非主仓 repoRef 显示目标仓名（主仓省略、非 TASK 无仓语义不渲染） */
export default function RepoRefTag({
  ticket,
  workspaceMap,
}: {
  ticket: Pick<Ticket, 'type' | 'repoRef' | 'workspaceId'>;
  workspaceMap: Map<string, Workspace> | null;
}) {
  const label = resolveRepoRefLabel(ticket, workspaceMap);
  if (label == null) return null;
  return (
    <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}
