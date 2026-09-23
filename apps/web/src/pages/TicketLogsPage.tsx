import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Spin, Switch, Typography } from 'antd';
import { ArrowLeftOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getLogs, getTicket } from '../api/tickets';
import type { TicketDetail, UnifiedEvent } from '../api/types';
import StatusLight from '../components/StatusLight';
import StatusTag, { TypeTag } from '../components/StatusTag';
import { formatClock, formatDuration, formatTime } from '../utils/format';
import { useNow } from '../utils/hooks';

/** 单次拉取事件条数（server tail 上限 500） */
const LOG_TAIL = 500;
/** 当前轮执行中的轮询间隔 */
const POLL_MS = 3000;
/** 轮询发现 finish 后延迟刷新详情（等待 server 结算转移） */
const FINISH_RELOAD_DELAY_MS = 2000;

/**
 * 执行日志页（类 CI job 视图）：Worker 原始过程不进详情页，独立成页承接。
 * - 轮次选择（默认跟随当前轮；查看历史轮时不轮询）
 * - 首行注入摘要（工单/worker/轮次/启动时间/耗时）
 * - 全量统一事件流：等宽字体滚动区，tool/text 分色；可切换「原始 JSON」查看事件元数据
 */
export default function TicketLogsPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ticketId = Number(params.id);
  const invalidId = !Number.isInteger(ticketId) || ticketId <= 0;

  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [events, setEvents] = useState<UnifiedEvent[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const loadDetail = useCallback(async (id: number, hasCache: boolean) => {
    try {
      const d = await getTicket(id);
      setDetail(d);
      setFailed(false);
      // 轮次选择默认跟随当前轮（仅首次与单号变化时重置；用户手选不被覆盖）
      setSelectedRound((prev) => (prev == null ? d.ticket.round : prev));
    } catch {
      setFailed(!hasCache);
    }
  }, []);

  // 新轮开启时自动跟随当前轮（重开/L2 重试后视角跟随最新动作）
  const roundRef = useRef<number | null>(null);
  useEffect(() => {
    if (detail == null) return;
    if (roundRef.current != null && roundRef.current !== detail.ticket.round) {
      setSelectedRound(detail.ticket.round);
    }
    roundRef.current = detail.ticket.round;
  }, [detail]);

  useEffect(() => {
    setDetail(null);
    setSelectedRound(null);
    setEvents(null);
    if (!invalidId) void loadDetail(ticketId, false);
  }, [ticketId, invalidId, loadDetail, reloadTick]);

  const ticket = detail?.ticket ?? null;
  const running = ticket != null && (ticket.status === 'IN_PROGRESS' || ticket.status === 'DISPATCHED');
  const viewingCurrent = ticket != null && selectedRound === ticket.round;
  const now = useNow(running && detail?.execution != null);

  // 事件流拉取 + 执行中轮询；finish 后延迟刷新详情拿终态
  useEffect(() => {
    if (ticket == null || selectedRound == null || selectedRound < 1) {
      setEvents(null);
      return;
    }
    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    const fetchLogs = async () => {
      try {
        const res = await getLogs(ticket.id, { round: selectedRound, tail: LOG_TAIL });
        if (cancelled) return;
        setEvents(res.events);
        setLogError(null);
        if (running && viewingCurrent && res.events.some((ev) => ev.type === 'finish')) {
          reloadTimer = setTimeout(() => {
            if (!cancelled) setReloadTick((t) => t + 1);
          }, FINISH_RELOAD_DELAY_MS);
        }
      } catch (e) {
        if (cancelled) return;
        // 静默失败（getLogs 不弹全局 toast），行内展示
        setLogError(e instanceof Error ? e.message : '日志加载失败');
      }
    };

    void fetchLogs();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (running && viewingCurrent) {
      timer = setInterval(fetchLogs, POLL_MS);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [ticket, selectedRound, running, viewingCurrent]);

  // 新事件到达自动滚到底部（类 CI job 跟随最新输出）
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, rawMode]);

  if (invalidId || (failed && detail == null)) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning"
          message="工单不存在或已加载失败"
          description={<Link to="/tickets">返回列表</Link>}
          showIcon
        />
      </div>
    );
  }

  if (ticket == null) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载中…" />
      </div>
    );
  }

  const neverRun = ticket.round < 1;

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 页头 */}
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/tickets/${ticket.id}`)}>
            返回详情
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            #{ticket.id} {ticket.title}
          </Typography.Title>
          <TypeTag type={ticket.type} />
          <StatusLight status={ticket.status} />
          <StatusTag status={ticket.status} />
          <Button icon={<ReloadOutlined />} onClick={() => setReloadTick((t) => t + 1)} />
        </Space>

        {/* 控制行：轮次选择 + 原始 JSON 切换 + 详情入口 */}
        <Space wrap style={{ justifyContent: 'space-between', display: 'flex' }}>
          <Space wrap>
            <Typography.Text type="secondary">轮次</Typography.Text>
            <Select
              size="small"
              style={{ width: 140 }}
              value={selectedRound ?? undefined}
              disabled={neverRun}
              onChange={setSelectedRound}
              options={Array.from({ length: ticket.round }, (_, i) => ({
                value: i + 1,
                label: `第 ${i + 1} 轮${i + 1 === ticket.round ? '（当前）' : ''}`,
              }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {running && viewingCurrent ? `执行中，每 ${POLL_MS / 1000}s 刷新` : viewingCurrent ? '已结束' : '历史轮次（不轮询）'}
            </Typography.Text>
          </Space>
          <Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              原始 JSON
            </Typography.Text>
            <Switch size="small" checked={rawMode} onChange={setRawMode} />
            <Link to={`/tickets/${ticket.id}`}>
              <Button size="small" icon={<FileTextOutlined />}>
                工单详情
              </Button>
            </Link>
          </Space>
        </Space>

        {/* 日志区（等宽字体滚动区，首行摘要） */}
        <div
          ref={logBoxRef}
          style={{
            background: '#0d1117',
            color: '#c9d1d9',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '12px 16px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.9,
            maxHeight: 'calc(100vh - 260px)',
            minHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {/* 首行注入摘要（raw 元数据概览） */}
          <div style={{ color: '#8b949e', borderBottom: '1px solid #21262d', paddingBottom: 6, marginBottom: 6 }}>
            # {formatTime(ticket.createdAt)} 创建 · worker {detail?.workerName ?? ticket.workerId ?? '未绑定'} · 第{' '}
            {selectedRound ?? 0} 轮
            {detail?.execution != null && viewingCurrent
              ? ` · 本轮启动 ${formatTime(detail.execution.startedAt)} · 已执行 ${formatDuration(now - detail.execution.startedAt)}`
              : ''}
            {` · 事件 ${events?.length ?? 0} 条（尾部最多 ${LOG_TAIL}）`}
          </div>

          {logError != null ? (
            <div style={{ color: '#f85149' }}>{logError}</div>
          ) : neverRun ? (
            <div style={{ color: '#8b949e' }}>该工单尚未执行过（无任何轮次日志）。</div>
          ) : events == null ? (
            <div style={{ color: '#8b949e' }}>加载中…</div>
          ) : events.length === 0 ? (
            <div style={{ color: '#8b949e' }}>
              第 {selectedRound} 轮暂无事件{running && viewingCurrent ? '（等待 worker 输出…）' : ''}
            </div>
          ) : (
            events.map((ev, idx) => (rawMode ? <RawLine key={idx} event={ev} /> : <EventLine key={idx} event={ev} />))
          )}
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          事件流由 worker 进程实时落盘（t{ticket.id}.r{selectedRound ?? 0}.events.jsonl）；工具行蓝、文本白、失败红。
        </Typography.Text>
      </Space>
    </div>
  );
}

/** 格式化事件行：tool/text 分色（类 CI job 输出） */
function EventLine({ event }: { event: UnifiedEvent }) {
  const ts = event.timestamp != null ? <span style={{ color: '#484f58', marginRight: 8 }}>{formatClock(event.timestamp)}</span> : null;
  switch (event.type) {
    case 'text-delta':
      return (
        <div style={{ color: '#c9d1d9' }}>
          {ts}
          {event.text ?? ''}
        </div>
      );
    case 'tool-call':
      return (
        <div>
          {ts}
          <span style={{ color: '#58a6ff' }}>▶ 工具 {event.tool ?? '?'}</span>
        </div>
      );
    case 'tool-result':
      return (
        <div>
          {ts}
          <span style={{ color: event.errored ? '#f85149' : '#8b949e' }}>
            {event.errored ? '✕ 工具失败' : '✓ 工具完成'} {event.tool ?? '?'}
          </span>
        </div>
      );
    case 'turn-start':
      return (
        <div style={{ color: '#484f58' }}>
          {ts}—— 回合开始 ——
        </div>
      );
    case 'turn-end':
      return (
        <div style={{ color: '#484f58' }}>
          {ts}—— 回合结束 ——
        </div>
      );
    case 'finish':
      return (
        <div>
          {ts}
          <span style={{ color: event.success ? '#3fb950' : '#f85149' }}>{event.success ? '✓ 执行结束' : '✕ 执行结束（失败）'}</span>
        </div>
      );
    default:
      // text-start/text-end 及扩展类型：无展示价值，跳过（原始 JSON 模式可查）
      return null;
  }
}

/** 原始 JSON 行（事件元数据完整展示） */
function RawLine({ event }: { event: UnifiedEvent }) {
  return <div style={{ color: '#8b949e' }}>{JSON.stringify(event)}</div>;
}
