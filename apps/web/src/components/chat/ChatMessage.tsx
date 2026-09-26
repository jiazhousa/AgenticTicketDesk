/**
 * 聊天消息气泡（user=右侧主色纯文本 / assistant=左侧浅底 markdown 渲染）。
 * streaming=true 为 delta 累积中的临时视图（text.ended 到达后以全文对齐收口）。
 * assistant 定稿文本支持 ```atd-plan 拆单计划块：提取成功渲染 PlanCard，块外文本照常 markdown；
 * 解析失败（JSON/形状不符）整块原样降级为文本。流式期间不提取（fence 未闭合时按普通代码块展示）。
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PlanPayload } from '../../api/types';
import PlanCard from './PlanCard';

/** assistant 消息分段：文本段（markdown）+ 计划段（PlanCard） */
type MessageSegment = { kind: 'text'; text: string } | { kind: 'plan'; plan: PlanPayload };

/** 计划块上下文（PlanCard 数据源与回调；未提供时定稿文本亦不提取——防御非聊天页复用） */
export interface PlanContext {
  sessionId: string;
  workspaceId: string;
  readOnly?: boolean;
  onConfirmed?: (storyId: number) => void;
}

/** fenced ```atd-plan 块（JSON.parse 成功且形状合规才提取，否则整块原样文本——会话不崩） */
const PLAN_BLOCK_RE = /```atd-plan[^\S\n]*\r?\n([\s\S]*?)```/g;

/** 形状防御：JSON 合法 ≠ 计划合法——story/tasks 必填字段齐且类型正确才可入 PlanCard（可选字段类型错整体降级） */
function asPlanPayload(v: unknown): PlanPayload | null {
  if (typeof v !== 'object' || v == null) return null;
  const { story, tasks } = v as { story?: unknown; tasks?: unknown };
  if (typeof story !== 'object' || story == null) return null;
  const s = story as { title?: unknown; description?: unknown };
  if (typeof s.title !== 'string' || typeof s.description !== 'string') return null;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const parsedTasks: PlanPayload['tasks'] = [];
  for (const raw of tasks) {
    if (typeof raw !== 'object' || raw == null) return null;
    const t = raw as Record<string, unknown>;
    if (
      typeof t.id !== 'string' ||
      typeof t.title !== 'string' ||
      typeof t.spec !== 'string' ||
      typeof t.workerId !== 'string'
    ) {
      return null;
    }
    if (t.repoRef != null && typeof t.repoRef !== 'string') return null;
    if (
      t.dependsOn != null &&
      (!Array.isArray(t.dependsOn) || t.dependsOn.some((d) => typeof d !== 'string'))
    ) {
      return null;
    }
    if (
      t.plannedFiles != null &&
      (!Array.isArray(t.plannedFiles) || t.plannedFiles.some((f) => typeof f !== 'string'))
    ) {
      return null;
    }
    parsedTasks.push({
      id: t.id,
      title: t.title,
      spec: t.spec,
      repoRef: t.repoRef ?? undefined, // JSON 无 undefined，null 归一为缺省（主仓）
      workerId: t.workerId,
      dependsOn: t.dependsOn as string[] | undefined,
      plannedFiles: t.plannedFiles as string[] | undefined,
    });
  }
  return { story: { title: s.title, description: s.description }, tasks: parsedTasks };
}

/**
 * 提取文本中的计划块（一块多卡：多次拆单各自成段）。
 * 返回 null=无成功提取的块（调用方走整段 markdown 原路径）；解析失败的块以原文归入文本段。
 */
function splitPlanBlocks(text: string): MessageSegment[] | null {
  const segments: MessageSegment[] = [];
  let found = false;
  let last = 0;
  for (const m of text.matchAll(PLAN_BLOCK_RE)) {
    const idx = m.index;
    if (idx == null) continue; // 正则以字面 ``` 开头，index 恒有——类型防御
    const before = text.slice(last, idx);
    if (before !== '') segments.push({ kind: 'text', text: before });
    let plan: PlanPayload | null = null;
    try {
      plan = asPlanPayload(JSON.parse(m[1]));
    } catch {
      plan = null; // JSON 解析失败 → 整块原样文本降级
    }
    if (plan != null) {
      segments.push({ kind: 'plan', plan });
      found = true;
    } else {
      segments.push({ kind: 'text', text: m[0] });
    }
    last = idx + m[0].length;
  }
  if (!found) return null;
  const tail = text.slice(last);
  if (tail !== '') segments.push({ kind: 'text', text: tail });
  return segments;
}

/** markdown 块级样式（antd 之外的最小集——表格边框/代码块底色/列表段落间距） */
const mdComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre
      style={{
        background: '#f6f8fa',
        padding: '10px 12px',
        borderRadius: 8,
        overflowX: 'auto',
        fontSize: 13,
        margin: '8px 0',
      }}
    >
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = /language-/.test(className ?? '');
    return (
      <code
        className={className}
        style={
          isBlock
            ? { fontFamily: 'ui-monospace, monospace', fontSize: 13 }
            : {
                fontFamily: 'ui-monospace, monospace',
                fontSize: 13,
                background: 'rgba(0, 0, 0, 0.06)',
                padding: '1px 5px',
                borderRadius: 4,
              }
        }
      >
        {children}
      </code>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 style={{ fontSize: 18, margin: '12px 0 8px' }}>{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 style={{ fontSize: 16, margin: '12px 0 8px' }}>{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ fontSize: 15, margin: '10px 0 6px' }}>{children}</h3>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table
      style={{
        borderCollapse: 'collapse',
        margin: '8px 0',
        fontSize: 13,
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th style={{ border: '1px solid #e5e5e5', padding: '4px 10px', background: '#fafafa' }}>{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td style={{ border: '1px solid #e5e5e5', padding: '4px 10px' }}>{children}</td>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote style={{ margin: '8px 0', padding: '2px 12px', borderLeft: '3px solid #e5e5e5', color: 'rgba(0,0,0,0.55)' }}>
      {children}
    </blockquote>
  ),
} as const;

export default function ChatMessage({
  role,
  text,
  streaming = false,
  planCtx,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  /** 计划块渲染上下文（不提供则不提取——assistant 文本按整段 markdown 渲染） */
  planCtx?: PlanContext;
}) {
  const isUser = role === 'user';
  // 定稿文本的计划块提取（流式中 fence 未闭合/无上下文/无成功块 → null 走整段原路径）
  const segments = useMemo(
    () => (!isUser && !streaming && planCtx != null ? splitPlanBlocks(text) : null),
    [isUser, streaming, planCtx, text],
  );

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {segments != null && planCtx != null ? (
        // 分段视图：块外文本保留气泡样式，计划卡以独立卡片纵向排列（结构化 UI 不塞气泡）
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '88%' }}>
          {segments.map((seg, i) =>
            seg.kind === 'plan' ? (
              <PlanCard
                key={i}
                plan={seg.plan}
                sessionId={planCtx.sessionId}
                workspaceId={planCtx.workspaceId}
                readOnly={planCtx.readOnly}
                onConfirmed={planCtx.onConfirmed}
              />
            ) : (
              <div
                key={i}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  wordBreak: 'break-word',
                  lineHeight: 1.7,
                  fontSize: 14,
                  background: '#fff',
                  border: '1px solid #ececec',
                  color: 'rgba(0, 0, 0, 0.88)',
                  borderBottomLeftRadius: 2,
                  overflowX: 'auto',
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
                  {seg.text}
                </ReactMarkdown>
              </div>
            ),
          )}
        </div>
      ) : (
        <div
          style={{
            maxWidth: '88%',
            padding: '8px 12px',
            borderRadius: 10,
            wordBreak: 'break-word',
            lineHeight: 1.7,
            fontSize: 14,
            ...(isUser
              ? {
                  background: '#1677ff',
                  color: '#fff',
                  borderBottomRightRadius: 2,
                  whiteSpace: 'pre-wrap',
                }
              : {
                  background: '#fff',
                  border: '1px solid #ececec',
                  color: 'rgba(0, 0, 0, 0.88)',
                  borderBottomLeftRadius: 2,
                  overflowX: 'auto',
                }),
          }}
        >
          {isUser ? (
            <>
              {text === '' && streaming ? '…' : text}
              {streaming && text !== '' ? <span style={{ opacity: 0.6 }}>▍</span> : null}
            </>
          ) : (
            // assistant 输出按 markdown 渲染（ReactMarkdown 默认不透传原始 HTML——agent 输出不注入页面）
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
                {text === '' && streaming ? '…' : text}
              </ReactMarkdown>
              {streaming && text !== '' ? <span style={{ opacity: 0.6 }}>▍</span> : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
