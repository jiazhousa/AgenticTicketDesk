import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getTicket } from '../api/tickets';
import type { Ticket } from '../api/types';
import StatusLight, { StatusLightLegend } from './StatusLight';

/** 泳道节点卡片尺寸与间距（手绘 SVG 布局常量，坐标按此确定性计算） */
const CARD_W = 216;
const CARD_H = 88;
const GAP_X = 24;
const GAP_Y = 56;

/** 轮询间隔：有单执行中 3s（橙闪→全绿→下游自动开工的流转可见），否则 10s */
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 10000;

/** 子单节点：工单 + 其在子单集合内部的依赖边（blockedBy 中属于兄弟单的部分） */
type SwimNode = {
  ticket: Ticket;
  /** 内部依赖（兄弟单） */
  deps: Ticket[];
  /** 外部依赖（如 BLOCKER 卡点单、非本 STORY 子单的依赖），提示用 */
  externalDeps: Ticket[];
};

/**
 * Story 泳道链（详情页核心区块）：按子单依赖关系分层 DAG。
 * - 拓扑分层：无依赖的第 0 层，依赖 k 层的在 k+1 层；同层横排=可并行
 * - 依赖箭头：下层节点指向上层来源（未完成的依赖虚线、已完成实线）
 * - 节点状态灯与全局一致（执行中橙呼吸 / 完成 绿 / 未开始 灰 …），
 *   实现「1/2/3 橙闪 → 全绿 → 4 自动橙闪」的编排链可视化
 * - 数据：STORY 详情（子单）+ 逐子单详情（依赖列表），N+1 拉取（本地单用户工具、几十节点规模可接受）
 */
export default function StorySwimlane({ storyId }: { storyId: number }) {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<SwimNode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const detail = await getTicket(storyId);
      const children = detail.children;
      if (children.length === 0) {
        setNodes([]);
        setFailed(false);
        return;
      }
      const childIds = new Set(children.map((c) => c.id));
      // 逐子单拉依赖（并行）；失败的单降级为无依赖展示，不阻断整图
      const depsPerChild = await Promise.all(
        children.map((c) =>
          getTicket(c.id)
            .then((d) => d.dependencies)
            .catch(() => [] as Ticket[]),
        ),
      );
      setNodes(
        children.map((c, i) => {
          const deps = depsPerChild[i];
          return {
            ticket: c,
            deps: deps.filter((d) => childIds.has(d.id)),
            externalDeps: deps.filter((d) => !childIds.has(d.id)),
          };
        }),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [storyId]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  // 自适应轮询：任一子单处于执行相关态时提频
  const active =
    nodes?.some((n) => n.ticket.status === 'IN_PROGRESS' || n.ticket.status === 'DISPATCHED') ?? false;
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  // 拓扑分层（最长路径）：layer(n) = 0 若无内部依赖，否则 max(layer(dep))+1
  const layers = useMemo(() => {
    if (nodes == null) return [];
    const byId = new Map(nodes.map((n) => [n.ticket.id, n]));
    const layerOf = new Map<number, number>();
    const remaining = new Set(nodes.map((n) => n.ticket.id));
    // 迭代松弛：每轮把「依赖已全部分层」的节点归层；server 保证 DAG，有限轮内完成
    let guard = nodes.length + 2;
    while (remaining.size > 0 && guard-- > 0) {
      let progressed = false;
      for (const id of [...remaining]) {
        const node = byId.get(id)!;
        if (node.deps.every((d) => layerOf.has(d.id))) {
          const layer = node.deps.length === 0 ? 0 : Math.max(...node.deps.map((d) => layerOf.get(d.id)!)) + 1;
          layerOf.set(id, layer);
          remaining.delete(id);
          progressed = true;
        }
      }
      if (!progressed) break; // 环防御（理论不可达）：剩余节点归入兜底层
    }
    const fallbackLayer = (layerOf.size === 0 ? 0 : Math.max(...layerOf.values()) + 1);
    const depth = Math.max(...[...layerOf.values(), fallbackLayer], 0) + 1;
    const result: SwimNode[][] = Array.from({ length: depth }, () => []);
    for (const n of nodes) {
      const layer = layerOf.get(n.ticket.id) ?? fallbackLayer;
      result[layer].push(n);
    }
    // 同层按单号稳定排序
    for (const arr of result) arr.sort((a, b) => a.ticket.id - b.ticket.id);
    return result;
  }, [nodes]);

  // 节点坐标（确定性布局：层为行、行内横排）
  const positions = useMemo(() => {
    const map = new Map<number, { x: number; y: number; node: SwimNode }>();
    layers.forEach((row, layerIdx) => {
      row.forEach((node, colIdx) => {
        map.set(node.ticket.id, {
          x: colIdx * (CARD_W + GAP_X),
          y: layerIdx * (CARD_H + GAP_Y),
          node,
        });
      });
    });
    return map;
  }, [layers]);

  const maxCols = Math.max(1, ...layers.map((l) => l.length));
  const boardW = maxCols * CARD_W + (maxCols - 1) * GAP_X;
  const boardH = layers.length * CARD_H + Math.max(0, layers.length - 1) * GAP_Y;

  if (failed) {
    return (
      <Alert
        type="error"
        showIcon
        message="泳道图加载失败"
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadTick((t) => t + 1)}>
            重试
          </Button>
        }
      />
    );
  }

  if (nodes == null) {
    return <Skeleton active paragraph={{ rows: 3 }} />;
  }

  if (nodes.length === 0) {
    return (
      <Typography.Text type="secondary">
        暂无子单——在子单下方的「依赖与父子」区或建单弹窗中挂子单后，这里展示编排链泳道。
      </Typography.Text>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <StatusLightLegend items={['DISPATCHED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DRAFT']} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          同层横排=可并行；箭头指向依赖来源（虚线=依赖未完成）· 每 {active ? 3 : 10}s 自动刷新
        </Typography.Text>
      </div>
      <div style={{ overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa', padding: 16 }}>
        <div style={{ position: 'relative', width: boardW, height: boardH, minWidth: '100%' }}>
          {/* 依赖连线（先画线后画卡，线被卡片自然截断视觉更清晰） */}
          <svg width={boardW} height={boardH} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              <marker id="atd-swim-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#8c8c8c" />
              </marker>
            </defs>
            {[...positions.values()].map(({ node }) =>
              node.deps.map((dep) => {
                const from = positions.get(node.ticket.id)!;
                const to = positions.get(dep.id);
                if (to == null) return null;
                // 下层节点顶边中点 → 上层来源底边中点
                const x1 = from.x + CARD_W / 2;
                const y1 = from.y;
                const x2 = to.x + CARD_W / 2;
                const y2 = to.y + CARD_H;
                const done = dep.status === 'DONE';
                return (
                  <line
                    key={`${node.ticket.id}-${dep.id}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={done ? '#95de64' : '#bfbfbf'}
                    strokeWidth={1.5}
                    strokeDasharray={done ? undefined : '5 4'}
                    markerEnd="url(#atd-swim-arrow)"
                  />
                );
              }),
            )}
          </svg>
          {/* 节点卡片 */}
          {[...positions.values()].map(({ x, y, node }) => (
            <SwimNodeCard key={node.ticket.id} x={x} y={y} node={node} onOpen={(id) => navigate(`/tickets/${id}`)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 泳道节点卡片：状态灯 + 单号 + 标题截断 + worker；执行中橙色描边强化「橙闪」体感 */
function SwimNodeCard({ x, y, node, onOpen }: { x: number; y: number; node: SwimNode; onOpen: (id: number) => void }) {
  const t = node.ticket;
  const executing = t.status === 'IN_PROGRESS';
  const borderColor = executing ? '#fa8c16' : t.status === 'DONE' ? '#95de64' : t.status === 'BLOCKED' ? '#ffa39e' : '#d9d9d9';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(t.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(t.id);
      }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: CARD_W,
        height: CARD_H,
        background: '#fff',
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
        boxShadow: executing ? '0 0 0 3px rgba(250, 140, 22, 0.15)' : undefined,
      }}
      title={`#${t.id} ${t.title}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusLight status={t.status} size={9} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          #{t.id}
        </Typography.Text>
        {t.workerId != null && (
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto', maxWidth: 90 }} ellipsis>
            {t.workerId}
          </Typography.Text>
        )}
      </div>
      <Typography.Text strong style={{ fontSize: 13 }} ellipsis={{ tooltip: t.title }}>
        {t.title}
      </Typography.Text>
      <div style={{ marginTop: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
        {node.externalDeps.length > 0 && (
          <Tag
            color="warning"
            style={{ marginRight: 0, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}
            title={`被集合外单据阻塞：${node.externalDeps.map((d) => `#${d.id}（${d.status}）`).join('、')}`}
          >
            外部依赖 {node.externalDeps.length}
          </Tag>
        )}
        {t.round >= 1 && (
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
            第 {t.round} 轮
          </Typography.Text>
        )}
      </div>
    </div>
  );
}
