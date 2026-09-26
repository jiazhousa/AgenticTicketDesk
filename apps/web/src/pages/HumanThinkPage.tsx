import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Form, Input, message, Modal, Segmented, Select, Space, Spin, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import {
  createHtSession,
  deleteHtSession,
  getHtSession,
  interruptHtSession,
  listHtPermissionRequests,
  listHtSessions,
  promptHtSession,
  replyHtPermission,
  subscribeHtEvents,
} from '../api/humanthink';
import { ApiError, getWorkers, listWorkspaces } from '../api/tickets';
import type {
  HumanThinkEvent,
  HumanThinkMirrorRow,
  HumanThinkPermissionRequest,
  HumanThinkSession,
  WorkerInfo,
  Workspace,
} from '../api/types';
import { useWorkspace } from '../context/WorkspaceContext';
import { useWorkspaceMap } from '../utils/workspace';
import { formatTime } from '../utils/format';
import { useInterval } from '../utils/hooks';
import ChatMessage from '../components/chat/ChatMessage';
import ReasoningBlock from '../components/chat/ReasoningBlock';
import ToolCard, { type ToolStatus } from '../components/chat/ToolCard';
import ApprovalCard, { type ApprovalState } from '../components/chat/ApprovalCard';

/** 活跃会话待审集合轮询间隔（审批即推 SSE，轮询兜首屏与断连窗口） */
const PERM_POLL_MS = 2000;
/** antd Header 默认高度（页面满高布局扣减） */
const HEADER_H = 64;

/* ==================== 事件流 → 聊天视图模型 ==================== */

type MessageItem = { kind: 'message'; key: string; role: 'user' | 'assistant'; text: string; streaming: boolean };
type ReasoningItem = { kind: 'reasoning'; key: string; text: string; streaming: boolean };
type ToolItem = { kind: 'tool'; key: string; tool: string; status: ToolStatus };
type ApprovalItem = {
  kind: 'approval';
  key: string;
  requestID: string;
  action: string;
  resources: string[];
  state: ApprovalState;
};
type ChatItem = MessageItem | ReasoningItem | ToolItem | ApprovalItem;

/**
 * 事件序列归并为聊天视图：delta 累积临时视图，durable 全文（text.ended/reasoning.ended）到达即对齐收口；
 * 已裁决审批卡不被滞后轮询回退；step.* 不进聊天视图。
 */
function toChatItems(events: HumanThinkEvent[], pendingPerms: HumanThinkPermissionRequest[]): ChatItem[] {
  const items: ChatItem[] = [];
  let msgId = 0;
  let reasoningId = 0;
  let toolId = 0;
  let openMessage: MessageItem | null = null;
  let openReasoning: ReasoningItem | null = null;

  /** 收口最后一个同名运行中工具卡；无匹配（重放窗口外孤儿结果帧）以终态直接落卡 */
  const closeTool = (tool: string | undefined, status: ToolStatus) => {
    const name = tool ?? '?';
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'tool' && it.tool === name && it.status === 'running') {
        it.status = status;
        return;
      }
    }
    items.push({ kind: 'tool', key: `t-${toolId++}`, tool: name, status });
  };

  const findApproval = (requestID: string): ApprovalItem | undefined =>
    items.find((it): it is ApprovalItem => it.kind === 'approval' && it.requestID === requestID);

  /** 裁决收口：按 requestID 定位（缺失时收口最后一个待审卡） */
  const resolveApproval = (requestID: string | undefined, state: ApprovalState) => {
    const target =
      requestID != null
        ? findApproval(requestID)
        : [...items].reverse().find((it): it is ApprovalItem => it.kind === 'approval' && it.state === 'pending');
    if (target != null) target.state = state;
  };

  const seenMessageIds = new Set<string>();
  for (const ev of events) {
    switch (ev.type) {
      case 'message': {
        // 镜像 message 行：用户消息主源（prompt 落行+SSE 转发）与对账 assistant 兜底；messageId 去重防御
        const mid = ev.messageId;
        if (mid != null) {
          if (seenMessageIds.has(mid)) break;
          seenMessageIds.add(mid);
        }
        items.push({
          kind: 'message',
          key: mid != null ? `m-${mid}` : `m-${msgId++}`,
          role: ev.role === 'assistant' ? 'assistant' : 'user',
          text: ev.text ?? '',
          streaming: false,
        });
        break;
      }
      case 'text.delta':
        if (openMessage == null) {
          openMessage = { kind: 'message', key: `m-${msgId++}`, role: 'assistant', text: '', streaming: true };
          items.push(openMessage);
        }
        openMessage.text += ev.text ?? '';
        break;
      case 'text.ended': {
        if (ev.role === 'user') {
          // 对账行携带用户消息时的防御渲染（镜像主源为助手全文）
          items.push({ kind: 'message', key: `m-${msgId++}`, role: 'user', text: ev.text ?? '', streaming: false });
          break;
        }
        if (openMessage != null) {
          // 全文主源对齐（替换 delta 累积；载荷空文本保留累积，防误清空）
          if (ev.text != null && ev.text !== '') openMessage.text = ev.text;
          openMessage.streaming = false;
          openMessage = null;
        } else {
          items.push({ kind: 'message', key: `m-${msgId++}`, role: 'assistant', text: ev.text ?? '', streaming: false });
        }
        break;
      }
      case 'reasoning.started':
        if (openReasoning == null) {
          openReasoning = { kind: 'reasoning', key: `r-${reasoningId++}`, text: '', streaming: true };
          items.push(openReasoning);
        } else {
          openReasoning.streaming = true;
        }
        break;
      case 'reasoning.delta':
        if (openReasoning == null) {
          openReasoning = { kind: 'reasoning', key: `r-${reasoningId++}`, text: '', streaming: true };
          items.push(openReasoning);
        }
        openReasoning.text += ev.text ?? '';
        break;
      case 'reasoning.ended':
        if (openReasoning != null) {
          // 载荷带全文则对齐；缺全文（记档接受面）保留 delta 累积
          if (ev.text != null && ev.text !== '') openReasoning.text = ev.text;
          openReasoning.streaming = false;
          openReasoning = null;
        } else if (ev.text != null && ev.text !== '') {
          items.push({ kind: 'reasoning', key: `r-${reasoningId++}`, text: ev.text, streaming: false });
        }
        break;
      case 'tool.called':
        items.push({ kind: 'tool', key: `t-${toolId++}`, tool: ev.tool ?? '?', status: 'running' });
        break;
      case 'tool.progress':
        break; // 运行中状态由卡片自带 loading 表达，无独立视图
      case 'tool.success':
        closeTool(ev.tool, 'success');
        break;
      case 'tool.failed':
        closeTool(ev.tool, 'failed');
        break;
      case 'permission.asked':
      case 'permission_request': {
        const requestID = ev.requestID ?? `unknown-${items.length}`;
        const existing = findApproval(requestID);
        if (existing != null) {
          // 回放重入：重置为待审（裁决事件可能落在窗口之后）
          existing.state = 'pending';
          existing.action = ev.action ?? '?';
          existing.resources = ev.resources ?? [];
        } else {
          items.push({
            kind: 'approval',
            key: `a-${requestID}`,
            requestID,
            action: ev.action ?? '?',
            resources: ev.resources ?? [],
            state: 'pending',
          });
        }
        break;
      }
      case 'permission.rejected':
        resolveApproval(ev.requestID, 'rejected');
        break;
      case 'permission_resolved':
        resolveApproval(ev.requestID, ev.decision === 'once' ? 'approved' : 'rejected');
        break;
      default:
        break;
    }
  }

  // 轮询待审集合为当前权威：仅补新卡与刷新待审卡，不回退已裁决卡（轮询响应可能滞后于 SSE 裁决）
  for (const p of pendingPerms) {
    const existing = findApproval(p.requestID);
    if (existing == null) {
      items.push({
        kind: 'approval',
        key: `a-${p.requestID}`,
        requestID: p.requestID,
        action: p.action,
        resources: p.resources,
        state: 'pending',
      });
    } else if (existing.state === 'pending') {
      existing.action = p.action;
      existing.resources = p.resources;
    }
  }

  return items;
}

/* ==================== 页面 ==================== */

/** 会话列表视图：正常（排除已删）/ 已删除（列出 deletedAt 非空，点击进只读详情） */
type ListMode = 'active' | 'deleted';

/** workspace 过滤「全部」哨兵 */
const ALL_WS = 'all';

/**
 * HumanThink 聊天页（/humanthink）：
 * 左栏=会话列表（workspace 过滤+搜索+已删查看入口）；右栏=聊天窗——
 * 流式回复（SSE delta+durable 全文对齐）/思考折叠/工具卡/审批卡（once-reject 两档）/中断；
 * 定稿回复中的 ```atd-plan 拆单计划块渲染计划卡（编辑/预检标红/确认建单，成功跳 STORY 详情）；
 * 已删会话转只读（详情内嵌历史，无操作按钮）。
 */
export default function HumanThinkPage() {
  const { workspaceId: ctxWorkspaceId } = useWorkspace();
  const workspaceMap = useWorkspaceMap();
  const navigate = useNavigate();

  // ---- 会话列表 ----
  const [wsFilter, setWsFilter] = useState<string | null>(ctxWorkspaceId);
  const [q, setQ] = useState('');
  const [listMode, setListMode] = useState<ListMode>('active');
  const [sessions, setSessions] = useState<HumanThinkSession[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listDegraded, setListDegraded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 顶栏全局 workspace 切换联动本页过滤
  useEffect(() => {
    setWsFilter(ctxWorkspaceId);
  }, [ctxWorkspaceId]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const items = await listHtSessions({
        workspaceId: wsFilter ?? undefined,
        q: q !== '' ? q : undefined,
        deleted: listMode === 'deleted',
      });
      setSessions(items);
      setListError(null);
      setListDegraded(false);
    } catch (e) {
      setSessions([]);
      setListError(e instanceof Error ? e.message : '会话列表加载失败');
      setListDegraded(e instanceof ApiError && e.code === 'WORKER_UNAVAILABLE');
    } finally {
      setListLoading(false);
    }
  }, [wsFilter, q, listMode]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // ---- 选中会话详情 + 事件流 ----
  const [session, setSession] = useState<HumanThinkSession | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [events, setEvents] = useState<HumanThinkEvent[]>([]);
  /** durable seq 去重集（回放与手动刷新重入防护） */
  const seenSeqRef = useRef<Set<number>>(new Set());
  /** SSE 初始游标（详情镜像最大 seq；订阅时一次性捕获） */
  const initialAfterRef = useRef<number | undefined>(undefined);

  /** 详情镜像行信封解包：拍平为与 SSE 帧一致的形态（{...event, seq, timestamp}），seq 去重与游标逻辑共用 */
  const resetFromMirror = useCallback((rows: HumanThinkMirrorRow[]) => {
    const mirror = rows.map((r) => ({ ...r.event, seq: r.seq, timestamp: r.createdAt }) as HumanThinkEvent);
    setEvents(mirror);
    seenSeqRef.current = new Set(mirror.filter((e) => typeof e.seq === 'number').map((e) => e.seq as number));
    initialAfterRef.current = mirror.reduce<number | undefined>(
      (max, e) => (typeof e.seq === 'number' && (max == null || e.seq > max) ? e.seq : max),
      undefined,
    );
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const res = await getHtSession(id);
        setSession(res.session);
        resetFromMirror(res.events);
        setDetailError(null);
      } catch (e) {
        setSession(null);
        setEvents([]);
        setDetailError(e instanceof Error ? e.message : '会话加载失败');
      }
    },
    [resetFromMirror],
  );

  // 切换会话：重拉详情（SSE 订阅与轮询随之重建/续期）
  useEffect(() => {
    if (selectedId == null) {
      setSession(null);
      setEvents([]);
      setDetailError(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const readOnly = session != null && session.deletedAt != null;

  /** 计划卡确认建单成功 → 跳 STORY 详情（泳道即有；子单依赖分层在详情可视） */
  const handlePlanConfirmed = useCallback(
    (storyId: number) => {
      message.success(`拆单计划已建 STORY #${storyId}`);
      navigate(`/tickets/${storyId}`);
    },
    [navigate],
  );

  /** 计划块渲染上下文（会话切换/只读态/回调变更为依赖，避免每渲染重建触发子组件重提取） */
  const planCtx = useMemo(
    () =>
      session != null
        ? {
            sessionId: session.id,
            workspaceId: session.workspaceId,
            readOnly,
            onConfirmed: handlePlanConfirmed,
          }
        : undefined,
    [session, readOnly, handlePlanConfirmed],
  );

  // ---- SSE 订阅（仅活跃会话；已删会话操作端点一律 422，不订阅） ----
  const [sseState, setSseState] = useState<'connected' | 'reconnecting' | null>(null);
  const sseSessionId = session != null && !readOnly ? session.id : null;
  useEffect(() => {
    if (sseSessionId == null) {
      setSseState(null);
      return;
    }
    setSseState('reconnecting');
    const sub = subscribeHtEvents(
      sseSessionId,
      {
        onFrame: (frame) => {
          if (typeof frame.seq === 'number') {
            if (seenSeqRef.current.has(frame.seq)) return; // durable 回放重入去重
            seenSeqRef.current.add(frame.seq);
          }
          setEvents((prev) => [...prev, { ...frame.event, seq: frame.seq }]);
        },
        onStateChange: setSseState,
      },
      initialAfterRef.current,
    );
    return () => sub.close();
  }, [sseSessionId]);

  // ---- 待审集合轮询（活跃会话；兼作会话健康探测——SESSION_TERMINATED 触发转只读） ----
  const [pendingPerms, setPendingPerms] = useState<HumanThinkPermissionRequest[]>([]);
  const pollPerms = useCallback(async () => {
    if (sseSessionId == null) return;
    try {
      setPendingPerms(await listHtPermissionRequests(sseSessionId));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_TERMINATED') {
        void loadDetail(sseSessionId); // 会话已在别处删除——刷新详情转只读视图
      }
      // 其余（瞬时网络/降级）静默：SSE 重连态已在头部展示
    }
  }, [sseSessionId, loadDetail]);
  useInterval(() => void pollPerms(), sseSessionId != null ? PERM_POLL_MS : null);

  // ---- 聊天窗派生态 ----
  const chatItems = useMemo(() => toChatItems(events, readOnly ? [] : pendingPerms), [events, pendingPerms, readOnly]);
  const generating = chatItems.some(
    (it) =>
      ((it.kind === 'message' || it.kind === 'reasoning') && it.streaming) ||
      (it.kind === 'tool' && it.status === 'running'),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el != null) el.scrollTop = el.scrollHeight;
  }, [chatItems]);

  // ---- 建会话弹窗 ----
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ workerId: string; workspaceId: string; title?: string }>();
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);

  const openCreate = useCallback(async () => {
    setCreateOpen(true);
    form.resetFields();
    try {
      const [ws, wk] = await Promise.all([listWorkspaces(), getWorkers()]);
      setWorkspaces(ws);
      setWorkers(wk);
    } catch {
      // 候选加载失败：toast 已弹，弹窗内空列表提示
      setWorkspaces([]);
      setWorkers([]);
    }
  }, [form]);

  // 弹窗缺省：workspace=顶栏所选 → atd（API 缺省）→ 列表第一个；worker=首个可用 interactive
  useEffect(() => {
    if (!createOpen || workspaces.length === 0) return;
    if (form.getFieldValue('workspaceId') != null) return;
    const preferred = ctxWorkspaceId ?? 'atd';
    const initial = workspaces.some((w) => w.id === preferred) ? preferred : workspaces[0].id;
    form.setFieldsValue({ workspaceId: initial });
  }, [createOpen, workspaces, ctxWorkspaceId, form]);

  // 可选 worker：声明 interactive 能力且非不可用态（协议不支撑 serve 常驻的被 Registry 标记）
  const workerOptions = useMemo(
    () => workers.filter((w) => w.capabilities.includes('interactive') && w.available !== false),
    [workers],
  );

  async function handleCreate() {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const created = await createHtSession({
        workerId: values.workerId,
        workspaceId: values.workspaceId,
        title: values.title?.trim() ? values.title.trim() : undefined,
      });
      setCreateOpen(false);
      // 新会话可能不在当前过滤视图内：过滤对齐其 workspace 后刷新并选入
      if (wsFilter !== created.workspaceId) setWsFilter(created.workspaceId);
      setListMode('active');
      await loadList();
      setSelectedId(created.id);
    } catch {
      // 建会话失败：toast 已弹，弹窗保留供重试
    } finally {
      setCreating(false);
    }
  }

  // ---- 聊天操作 ----
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingFor, setReplyingFor] = useState<string | null>(null);

  async function handleSend() {
    const text = input.trim();
    if (text === '' || session == null || readOnly || sending) return;
    setSending(true);
    setInput('');
    try {
      await promptHtSession(session.id, text);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_TERMINATED') void loadDetail(session.id);
      else setInput(text); // 发送失败还原输入，避免用户重打
    } finally {
      setSending(false);
    }
  }

  async function handleInterrupt() {
    if (session == null || readOnly) return;
    try {
      await interruptHtSession(session.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_TERMINATED') void loadDetail(session.id);
    }
  }

  async function handleDelete() {
    if (session == null || readOnly) return;
    try {
      await deleteHtSession(session.id);
      await loadList();
      void loadDetail(session.id); // 留在原会话转只读（历史仍可查）
    } catch {
      // 失败 toast 已弹
    }
  }

  async function handleReply(requestID: string, decision: 'once' | 'reject') {
    if (session == null || readOnly) return;
    setReplyingFor(requestID);
    try {
      await replyHtPermission(session.id, requestID, { decision });
      // 乐观收口（SSE permission_resolved 到达后按 requestID 幂等同态）
      setEvents((prev) => [...prev, { type: 'permission_resolved', requestID, decision }]);
      void pollPerms();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_TERMINATED') void loadDetail(session.id);
    } finally {
      setReplyingFor(null);
    }
  }

  /* ==================== 渲染 ==================== */

  const wsOptions = [
    { value: ALL_WS, label: '全部' },
    ...(workspaceMap == null
      ? []
      : [...workspaceMap.values()].map((w) => ({ value: w.id, label: `${w.name} · ${w.primary}` }))),
  ];

  return (
    <div style={{ display: 'flex', height: `calc(100vh - ${HEADER_H}px)`, minHeight: 420 }}>
      {/* 左栏：会话列表 */}
      <aside
        style={{
          width: 300,
          flex: 'none',
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 12px 8px',
          gap: 8,
        }}
      >
        <Space style={{ justifyContent: 'space-between', display: 'flex' }}>
          <Typography.Text strong>会话</Typography.Text>
          <Space size={4}>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadList()} loading={listLoading} />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
              新建
            </Button>
          </Space>
        </Space>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={wsFilter ?? ALL_WS}
          options={wsOptions}
          loading={workspaceMap == null}
          onChange={(v) => setWsFilter(v === ALL_WS ? null : v)}
        />
        <Input.Search size="small" placeholder="搜索标题/内容" onSearch={setQ} allowClear />
        <Segmented
          block
          size="small"
          value={listMode}
          options={[
            { label: '进行中', value: 'active' },
            { label: '已删除', value: 'deleted' },
          ]}
          onChange={(v) => setListMode(v as ListMode)}
        />
        {listError != null ? (
          <Alert
            type="error"
            showIcon
            message={listError}
            description={listDegraded ? '聊天服务不可用（worker serve 未就绪或已降级），工单功能不受影响' : undefined}
          />
        ) : null}
        <div style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
          {sessions == null ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin />
            </div>
          ) : sessions.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {listMode === 'deleted' ? '暂无已删除会话' : '暂无会话——点「新建」选 worker × workspace 开聊'}
            </Typography.Text>
          ) : (
            sessions.map((s) => {
              const selected = s.id === selectedId;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: selected ? '#e6f4ff' : 'transparent',
                    border: `1px solid ${selected ? '#91caff' : 'transparent'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                    <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                      {s.title !== '' ? s.title : '（未命名）'}
                    </Typography.Text>
                    {s.deletedAt != null ? <Tag color="red" style={{ marginRight: 0 }}>
                      已删除
                    </Tag> : null}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {s.workerId} · {formatTime(s.createdAt)}
                  </Typography.Text>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 右栏：聊天窗 */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {session == null ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {detailError != null ? (
              <Alert type="warning" showIcon message={detailError} style={{ maxWidth: 420 }} />
            ) : (
              <Typography.Text type="secondary">选择左侧会话，或新建一个开始讨论</Typography.Text>
            )}
          </div>
        ) : (
          <>
            {/* 聊天头部 */}
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 52,
              }}
            >
              <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>
                {session.title !== '' ? session.title : `会话 ${session.id.slice(0, 8)}…`}
              </Typography.Text>
              <Tag>{session.workerId}</Tag>
              <Tag>{session.workspaceId}</Tag>
              {readOnly ? (
                <Tag color="red">已删除（只读）</Tag>
              ) : sseState === 'connected' ? (
                <Tag color="success">实时</Tag>
              ) : (
                <Tag color="warning">重连中…</Tag>
              )}
              {!readOnly ? (
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<StopOutlined />}
                    onClick={() => void handleInterrupt()}
                    disabled={!generating}
                  >
                    中断
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>
                    删除
                  </Button>
                </Space>
              ) : null}
            </div>
            <Typography.Text
              type="secondary"
              ellipsis
              style={{ fontSize: 12, padding: '2px 16px', flex: 'none' }}
              title={session.directory}
            >
              {session.directory}
            </Typography.Text>

            {readOnly ? (
              <Alert
                type="info"
                showIcon
                message="该会话已删除（只读）——历史记录仍可查看，不支持继续发送/中断/删除/审批。"
                style={{ margin: '8px 16px 0' }}
              />
            ) : null}

            {/* 消息区 */}
            <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
              {/* 块级 flex + margin auto 居中——antd Space 为 inline-flex，margin auto 无效导致宽屏左锚定（验收反馈） */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  width: '100%',
                  maxWidth: 860,
                  margin: '0 auto',
                }}
              >
                {chatItems.length === 0 ? (
                  <Typography.Text type="secondary">
                    {readOnly ? '该会话无历史事件。' : '发送第一句话开始讨论——助手可见 workspace 声明的仓，敏感动作会先请示。'}
                  </Typography.Text>
                ) : (
                  chatItems.map((it) => {
                    switch (it.kind) {
                      case 'message':
                        return (
                          <ChatMessage
                            key={it.key}
                            role={it.role}
                            text={it.text}
                            streaming={it.streaming}
                            planCtx={planCtx}
                          />
                        );
                      case 'reasoning':
                        return <ReasoningBlock key={it.key} text={it.text} streaming={it.streaming} />;
                      case 'tool':
                        return <ToolCard key={it.key} tool={it.tool} status={it.status} />;
                      case 'approval':
                        // 审批卡不在对话流渲染——集中右侧审查位（OpenCode 网页端同款三栏模式）
                        return null;
                    }
                  })
                )}
              </div>
            </div>

            {/* 输入区（已删只读隐藏） */}
            {!readOnly ? (
              <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 20px' }}>
              <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 860, margin: '0 auto' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
                  disabled={sending}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  disabled={input.trim() === ''}
                  onClick={() => void handleSend()}
                >
                  发送
                </Button>
              </div>
              </div>
            ) : null}
            {generating && !readOnly ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, padding: '0 16px 8px' }}>
                生成中…可点「中断」停止
              </Typography.Text>
            ) : null}
          </>
        )}
      </main>

      {/* 审查位（右栏）：审批请求集中在此——待审可裁决，已裁决留痕（OpenCode 网页端三栏模式的右侧面板） */}
      {session != null ? (
        <aside
          style={{
            width: 300,
            flex: 'none',
            borderLeft: '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              审查
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {chatItems.filter((it) => it.kind === 'approval' && it.state === 'pending').length > 0
                ? `${chatItems.filter((it) => it.kind === 'approval' && it.state === 'pending').length} 项待审`
                : '无待审'}
            </Typography.Text>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
            {chatItems.filter((it) => it.kind === 'approval').length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Agent 请求执行敏感动作（跑命令/改文件）时，审批卡会出现在这里
              </Typography.Text>
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {[...chatItems]
                  .reverse()
                  .filter((it): it is Extract<ChatItem, { kind: 'approval' }> => it.kind === 'approval')
                  .map((it) => (
                    <ApprovalCard
                      key={it.key}
                      action={it.action}
                      resources={it.resources}
                      state={it.state}
                      replying={replyingFor === it.requestID}
                      onReply={(d) => void handleReply(it.requestID, d)}
                    />
                  ))}
              </Space>
            )}
          </div>
        </aside>
      ) : null}

      {/* 建会话弹窗 */}
      <Modal
        title="新建会话"
        open={createOpen}
        onOk={() => void handleCreate()}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={creating}
        okText="开始聊天"
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="workerId"
            label="助手（worker）"
            rules={[{ required: true, message: '选择提供聊天能力的 worker' }]}
            extra={
              workerOptions.length === 0
                ? '暂无可用 interactive worker（未声明聊天能力或协议不支撑的不会列出）'
                : undefined
            }
          >
            <Select
              placeholder="选择 worker"
              options={workerOptions.map((w) => ({ value: w.id, label: `${w.name}（${w.id}）` }))}
            />
          </Form.Item>
          <Form.Item name="workspaceId" label="项目群（workspace）" rules={[{ required: true, message: '选择 workspace' }]}>
            <Select
              placeholder="选择 workspace"
              options={workspaces.map((w) => ({ value: w.id, label: `${w.name} · ${w.primary}` }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题（可选）">
            <Input placeholder="例如：聊聊导出功能的需求" maxLength={80} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
