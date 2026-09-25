import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { UnifiedEvent } from '@atd/worker-core';
import { humanthinkEvents, humanthinkSessions } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { ServeHandle } from './serve-manager.js';
import { assistantText, type SessionFacade, type SessionMessage } from './session-facade.js';

/**
 * humanthink 事件子系统（S2b1 技术方案 4+5）。
 * 双通道：live=全局 GET /api/event 单条 SSE 按 sessionID 分发（delta 仅转发不落库）；
 * 镜像=durable 子集落 humanthink_events（幂等键=(session_id, serve_seq)，信封缺失跳过落库仅转发+warn）；
 * 恢复=重连全局流 + 活跃会话 message 对账（对账行 serve_seq=NULL，(session_id, messageId) 先查后插）；
 * 审批=permission.asked/replied 写 ATD 自有行（requestID 应用层幂等）+ 活跃会话 2s 轮询兜底。
 */

/** 镜像行 type 值域（冻结——块 2 手抄参照源；web 不得擅自扩展） */
export type HumanThinkMirrorType =
  | 'text.ended'
  | 'reasoning.started'
  | 'reasoning.ended'
  | 'tool.called'
  | 'tool.success'
  | 'tool.failed'
  | 'tool.progress'
  | 'step.started'
  | 'step.ended'
  | 'permission.asked'
  | 'permission.rejected'
  | 'permission_request'
  | 'permission_resolved'
  | 'message';

/** SSE/live 帧事件形态（payload.type 自描述；delta 型不落库） */
export type HumanThinkEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'text.ended'; text: string; messageID?: string }
  | { type: 'reasoning.started'; messageID?: string }
  | { type: 'reasoning.ended'; text: string; messageID?: string }
  | { type: 'tool.called'; callID: string; tool: string; input?: unknown }
  | { type: 'tool.success'; callID: string; tool: string }
  | { type: 'tool.failed'; callID: string; tool: string; error?: { type: string; message?: string } }
  | { type: 'tool.progress'; callID: string; tool: string }
  | { type: 'step.started'; messageID?: string }
  | { type: 'step.ended'; finish?: string }
  | { type: 'permission.asked'; requestID: string; action: string; resources: string[] }
  | { type: 'permission.rejected'; requestID?: string; message?: string }
  | { type: 'permission_request'; requestID: string; action: string; resources: string[]; status: 'pending' }
  | { type: 'permission_resolved'; requestID: string; decision?: string }
  | { type: 'message'; messageId: string; role: 'user' | 'assistant'; text: string };

/** SSE 帧：durable/镜像事件带本地 seq，delta 帧无 seq（断线以最后 durable seq 为 after 重连） */
export type SseFrame = { seq?: number; event: HumanThinkEvent };

/** serve 全局流信封（探针实证：{id, created, type, location?, data, durable?}） */
type ServeEnvelope = {
  type: string;
  data: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number; version: number };
};

/** 落库镜像的 serve 事件短名集合（durable 子集） */
const MIRROR_EVENTS = new Set([
  'session.text.ended',
  'session.reasoning.started',
  'session.reasoning.ended',
  'session.tool.called',
  'session.tool.success',
  'session.tool.failed',
  'session.tool.progress',
  'session.step.started',
  'session.step.ended',
]);

/** 审批轮询周期 */
const PERMISSION_POLL_MS = 2000;/** 流重连退避（上限 4s 持续重试——serve 存活期内流断必恢复） */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];
/** message 对账分页大小 */
const RECONCILE_PAGE = 100;

export class EventHub {
  private stopped = true;
  private loopRunning = false;
  private abort: AbortController | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  /** per-session SSE 直推监听器（attach 注册） */
  private readonly listeners = new Map<string, Set<(f: SseFrame) => void>>();
  /** 本地 seq 缓存（单进程串行分配） */
  private readonly seqCache = new Map<string, number>();
  /** callID → 工具名（tool.input.started 供养成；tool.* 镜像载荷补全） */
  private readonly toolNames = new Map<string, string>();

  constructor(
    private readonly deps: {
      db: BetterSQLite3Database<typeof schema>;
      serve: () => ServeHandle | null;
      facade: SessionFacade;
      fetchImpl?: typeof fetch;
      now?: () => number;
      log?: (msg: string) => void;
    },
  ) {}

  private log(msg: string): void {
    (this.deps.log ?? ((m) => console.log(`[atd-humanthink] ${m}`)))(msg);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  /** 启动：全局流订阅循环 + 审批轮询（app 装配旁路位启用时由启动时序调用） */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.pollTimer = setInterval(() => this.pollPermissions(), PERMISSION_POLL_MS);
    this.pollTimer.unref?.();
    void this.streamLoop();
  }

  /** 停止（Fastify onClose）：断流 + 停轮询 */
  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.abort = null;
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 全局流循环：serve 就绪即连；断开按退避重连，每次成功建立连接即对账活跃会话 */
  private async streamLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;
    let backoffIdx = 0;
    while (!this.stopped) {
      const handle = this.deps.serve();
      if (handle == null) {
        await sleep(1000);
        continue;
      }
      const ok = await this.consumeStream(handle);
      if (this.stopped) break;
      if (ok) {
        backoffIdx = 0;
      } else {
        await sleep(RECONNECT_BACKOFF_MS[Math.min(backoffIdx, RECONNECT_BACKOFF_MS.length - 1)]);
        backoffIdx += 1;
      }
    }
    this.loopRunning = false;
  }

  /** 消费全局 SSE 直到断开；连接建立即触发对账（断流窗口的消息文本以 message 端点为权威兜底） */
  private async consumeStream(handle: ServeHandle): Promise<boolean> {
    this.abort = new AbortController();
    try {
      const res = await (this.deps.fetchImpl ?? fetch)(`${handle.baseUrl}/api/event`, {
        headers: { authorization: handle.authHeader, accept: 'text/event-stream' },
        signal: this.abort.signal,
      });
      if (!res.ok || res.body == null) {
        this.log(`全局事件流连接失败：HTTP ${res.status}`);
        return false;
      }
      // 连接成功即对账（启动恢复与断流补齐共用同一路径；异步执行不阻塞流消费）
      void this.reconcileAll();
      await this.readSse(res.body, (data) => this.onServeEvent(data));
      this.log('全局事件流结束，准备重连');
      return true;
    } catch (err) {
      if (this.stopped) return false;
      this.log(`全局事件流中断：${(err as Error).message}`);
      return false;
    } finally {
      this.abort = null;
    }
  }

  /** 手写 SSE 解析：帧以空行分隔，data: 行聚合；注释行（: heartbeat）忽略 */
  private async readSse(body: ReadableStream<Uint8Array>, onEvent: (json: string) => void): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];
    const dispatch = (): void => {
      if (dataLines.length > 0) {
        onEvent(dataLines.join('\n'));
        dataLines = [];
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line === '') {
          dispatch();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // 其余行（注释/事件名/重试提示）忽略——serve 只用 data 帧
      }
    }
    dispatch();
  }

  /** serve 事件分发入口：信封解析 → 会话归属 → 镜像/自有行/仅转发三分流 */
  private onServeEvent(json: string): void {
    if (this.stopped) return;
    try {
      this.dispatchServeEvent(json);
    } catch (err) {
      // 单事件异常不中断流消费（落库竞争/形态异常记日志跳过）
      this.log(`事件处理异常：${(err as Error).message}`);
    }
  }

  private dispatchServeEvent(json: string): void {
    let ev: ServeEnvelope;
    try {
      const parsed = JSON.parse(json) as ServeEnvelope;
      if (typeof parsed?.type !== 'string' || typeof parsed?.data !== 'object' || parsed.data === null) return;
      ev = parsed;
    } catch {
      return; // 非载荷帧（heartbeat 等已被解析层过滤，防御分支）
    }
    const sessionId = typeof ev.data.sessionID === 'string' ? ev.data.sessionID : null;
    const ht = toHumanThinkEvent(ev, this.toolNames);
    if (ht == null) return;
    // 权限/会话事件均携带 sessionID（探针实证）；无 sessionID 的事件无从归属，丢弃
    if (sessionId == null || !this.knownSession(sessionId)) return; // 非 ATD 会话（共享数据目录下的外来会话）

    switch (ht.type) {
      // —— 仅转发（delta 动画，不落库）——
      case 'text.delta':
      case 'reasoning.delta':
        this.forward(sessionId, { event: ht });
        return;
      // —— ATD 自有权限行（无信封为常态，requestID 应用层幂等）——
      case 'permission.asked':
        this.insertPermissionRow(sessionId, 'permission_request', {
          type: 'permission_request',
          requestID: ht.requestID,
          action: ht.action,
          resources: ht.resources,
          status: 'pending',
        });
        return;
      case 'permission.rejected':
        this.insertPermissionRow(sessionId, 'permission.rejected', {
          type: 'permission.rejected',
          ...(ht.requestID != null ? { requestID: ht.requestID } : {}),
          ...(ht.message != null ? { message: ht.message } : {}),
        });
        return;
      case 'permission_resolved':
        this.insertPermissionRow(sessionId, 'permission_resolved', {
          type: 'permission_resolved',
          requestID: ht.requestID,
          ...(ht.decision != null ? { decision: ht.decision } : {}),
        });
        return;
      default:
        break;
    }
    // —— durable 子集镜像：信封缺失跳过落库仅转发+warn（不做退化双键）——
    if (!MIRROR_EVENTS.has(ev.type)) return;
    const serveSeq = ev.durable?.seq;
    if (typeof serveSeq !== 'number') {
      this.log(`事件 ${ev.type} 缺失 durable.seq 信封，跳过落库仅转发（版本演进关注项）`);
      this.forward(sessionId, { event: ht });
      return;
    }
    const seq = this.insertMirrored(sessionId, serveSeq, ht);
    if (seq != null) this.forward(sessionId, { seq, event: ht });
  }

  // ---------- 落库路径 ----------

  private knownSession(sessionId: string): boolean {
    const row = this.deps.db
      .select({ id: humanthinkSessions.id })
      .from(humanthinkSessions)
      .where(eq(humanthinkSessions.id, sessionId))
      .get();
    return row != null;
  }

  /** 本地 seq 分配（每会话递增；缓存避免逐事件查询） */
  private nextSeq(sessionId: string): number {
    let last = this.seqCache.get(sessionId);
    if (last == null) {
      const row = this.deps.db
        .select({ maxSeq: sql<number>`max(${humanthinkEvents.seq})` })
        .from(humanthinkEvents)
        .where(eq(humanthinkEvents.sessionId, sessionId))
        .get();
      last = row?.maxSeq ?? 0;
    }
    const next = last + 1;
    this.seqCache.set(sessionId, next);
    return next;
  }

  /** 镜像落库：幂等键=(session_id, serve_seq) 冲突静默跳过；返回新分配 seq（重复返回 null） */
  private insertMirrored(sessionId: string, serveSeq: number, event: HumanThinkEvent): number | null {
    const inserted = this.deps.db
      .insert(humanthinkEvents)
      .values({
        sessionId,
        serveSeq,
        seq: this.nextSeq(sessionId),
        type: event.type,
        payload: JSON.stringify(event),
        createdAt: this.now(),
      })
      .onConflictDoNothing({ target: [humanthinkEvents.sessionId, humanthinkEvents.serveSeq] })
      .returning({ seq: humanthinkEvents.seq })
      .all();
    if (inserted.length === 0) {
      // 重复事件（重连后 serve 侧重放等）：回退 seq 缓存避免空洞扩大
      this.seqCache.set(sessionId, this.seqCache.get(sessionId)! - 1);
      return null;
    }
    this.touchSession(sessionId);
    return inserted[0].seq;
  }

  /** ATD 自有行/对账行（serve_seq=NULL）：应用层先查后插（单进程串行无竞态） */
  private insertOwnRow(sessionId: string, type: HumanThinkMirrorType, payload: Record<string, unknown>, dedupe?: { key: string; value: string }): number | null {
    if (dedupe != null) {
      const jsonPath = `$.${dedupe.key}`;
      const exists = this.deps.db
        .select({ id: humanthinkEvents.id })
        .from(humanthinkEvents)
        .where(
          and(
            eq(humanthinkEvents.sessionId, sessionId),
            eq(humanthinkEvents.type, type),
            sql`json_extract(${humanthinkEvents.payload}, ${jsonPath}) = ${dedupe.value}`,
          ),
        )
        .get();
      if (exists != null) return null;
    }
    const seq = this.nextSeq(sessionId);
    this.deps.db.insert(humanthinkEvents).values({
      sessionId,
      serveSeq: null,
      seq,
      type,
      payload: JSON.stringify(payload),
      createdAt: this.now(),
    }).run();
    this.touchSession(sessionId);
    return seq;
  }

  /** 权限事件统一入口（requestID 幂等） */
  private insertPermissionRow(sessionId: string, type: 'permission_request' | 'permission_resolved' | 'permission.rejected', payload: Record<string, unknown>): void {
    const requestID = typeof payload.requestID === 'string' ? payload.requestID : null;
    const seq = this.insertOwnRow(
      sessionId,
      type,
      payload,
      requestID != null ? { key: 'requestID', value: requestID } : undefined,
    );
    // 裁决落库时同步翻转 request 行 status=pending→resolved（待审列表只看 pending）
    if (seq != null && type === 'permission_resolved' && requestID != null) {
      this.deps.db.run(sql`
        UPDATE humanthink_events
        SET payload = json_set(payload, '$.status', 'resolved')
        WHERE session_id = ${sessionId} AND type = 'permission_request' AND json_extract(payload, '$.requestID') = ${requestID}
      `);
    }
    if (seq != null) this.forward(sessionId, { seq, event: payload as HumanThinkEvent });
  }

  /** 会话活跃时刻维护 */
  private touchSession(sessionId: string): void {
    this.deps.db
      .update(humanthinkSessions)
      .set({ lastActiveAt: this.now() })
      .where(eq(humanthinkSessions.id, sessionId))
      .run();
  }

  // ---------- 对账（恢复补齐） ----------

  /** 全部活跃（未删）会话对账：message 翻页回放 + 权限快照 */
  async reconcileAll(): Promise<void> {
    const active = this.deps.db
      .select({ id: humanthinkSessions.id })
      .from(humanthinkSessions)
      .where(isNull(humanthinkSessions.deletedAt))
      .all();
    for (const s of active) {
      await this.reconcileSession(s.id);
      await this.refreshPermissions(s.id);
    }
  }

  /** 单会话对账：serve message 列表为文本权威兜底——(session_id, messageId) 先查后插 */
  private async reconcileSession(sessionId: string): Promise<void> {
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await this.deps.facade.listMessages(sessionId, { limit: RECONCILE_PAGE, order: 'asc', cursor });
        for (const msg of page.data) {
          this.reconcileMessage(sessionId, msg);
        }
        if (page.cursor.next == null) break;
        cursor = page.cursor.next;
      }
    } catch (err) {
      this.log(`会话 ${sessionId} message 对账失败：${(err as Error).message}`);
    }
  }

  /** 单消息对账：user/assistant 文本行（idle 等杂型跳过；已镜像的 assistant 文本跳过） */
  private reconcileMessage(sessionId: string, msg: SessionMessage): void {
    if (msg.type !== 'user' && msg.type !== 'assistant') return;
    // assistant 全文已有镜像行（text.ended messageID 命中）→ 不重复落
    if (msg.type === 'assistant') {
      const mirrored = this.deps.db
        .select({ id: humanthinkEvents.id })
        .from(humanthinkEvents)
        .where(
          and(
            eq(humanthinkEvents.sessionId, sessionId),
            eq(humanthinkEvents.type, 'text.ended'),
            sql`json_extract(${humanthinkEvents.payload}, '$.messageID') = ${msg.id}`,
          ),
        )
        .get();
      if (mirrored != null) return;
    }
    const text = msg.type === 'user' ? (msg.text ?? '') : assistantText(msg);
    this.insertOwnRow(
      sessionId,
      'message',
      { type: 'message', messageId: msg.id, role: msg.type, text },
      { key: 'messageId', value: msg.id },
    );
  }

  /** 权限快照刷新（对账与轮询共用）：新出现的 pending 落 permission_request 行 */
  private async refreshPermissions(sessionId: string): Promise<void> {
    try {
      const pending = await this.deps.facade.listPermissions(sessionId);
      for (const p of pending) {
        this.insertPermissionRow(sessionId, 'permission_request', {
          type: 'permission_request',
          requestID: p.id,
          action: p.action,
          resources: p.resources,
          status: 'pending',
        });
      }
    } catch {
      // 会话可能在 serve 侧已不存在（404）——对账路径不因单会话失败中断
    }
  }

  /** 审批轮询（2s）：覆盖有 SSE 订阅者的会话与存在 pending 行的会话；消失的 pending 补 resolved 行 */
  private pollPermissions(): void {
    if (this.stopped) return;
    const pollSet = new Set<string>([...this.listeners.keys()]);
    const pendingSessions = this.deps.db
      .selectDistinct({ id: humanthinkEvents.sessionId })
      .from(humanthinkEvents)
      .where(and(eq(humanthinkEvents.type, 'permission_request'), sql`json_extract(${humanthinkEvents.payload}, '$.status') = 'pending'`))
      .all();
    for (const s of pendingSessions) pollSet.add(s.id);
    for (const sessionId of pollSet) {
      void this.pollSession(sessionId);
    }
  }

  private async pollSession(sessionId: string): Promise<void> {
    if (this.stopped) return;
    let pending: Array<{ id: string }>;
    try {
      pending = await this.deps.facade.listPermissions(sessionId);
    } catch {
      return; // serve 不可达/会话已删——下轮再查
    }
    const liveIDs = new Set(pending.map((p) => p.id));
    for (const p of pending) {
      this.insertPermissionRow(sessionId, 'permission_request', {
        type: 'permission_request',
        requestID: p.id,
        action: (p as { action?: string }).action ?? 'unknown',
        resources: (p as { resources?: string[] }).resources ?? [],
        status: 'pending',
      });
    }
    // 已消失的 pending：流断窗口内被外部裁决——补 permission_resolved（decision 缺省=非本端裁决）
    const knownPending = this.deps.db
      .select({ payload: humanthinkEvents.payload })
      .from(humanthinkEvents)
      .where(
        and(
          eq(humanthinkEvents.sessionId, sessionId),
          eq(humanthinkEvents.type, 'permission_request'),
          sql`json_extract(${humanthinkEvents.payload}, '$.status') = 'pending'`,
        ),
      )
      .all();
    for (const row of knownPending) {
      const req = JSON.parse(row.payload) as { requestID: string };
      if (!liveIDs.has(req.requestID)) {
        this.insertPermissionRow(sessionId, 'permission_resolved', {
          type: 'permission_resolved',
          requestID: req.requestID,
        });
      }
    }
  }

  /** 本端审批裁决入口（routes reply 成功后调用） */
  recordReply(sessionId: string, requestID: string, decision: 'once' | 'reject'): void {
    this.insertPermissionRow(sessionId, 'permission_resolved', {
      type: 'permission_resolved',
      requestID,
      decision,
    });
  }

  /** 用户消息即时落历史行（prompt 端点调用；messageId 幂等，对账时自动去重） */
  insertUserMessage(sessionId: string, messageId: string, text: string): void {
    const seq = this.insertOwnRow(
      sessionId,
      'message',
      { type: 'message', messageId, role: 'user', text },
      { key: 'messageId', value: messageId },
    );
    if (seq != null) this.forward(sessionId, { seq, event: { type: 'message', messageId, role: 'user', text } });
  }

  // ---------- SSE 合流（路由侧） ----------

  /**
   * attach：注册 live 监听 → 回放镜像 seq>after。整段同步执行（单进程事件循环原子性），
   * 注册与回放之间无流事件插入窗口，无需额外转发缓冲；delta 设计不重放
   * （断线以最后 durable seq 为 after 重连，UI 以镜像全文对齐）。返回 detach。
   */
  attach(sessionId: string, after: number, send: (frame: SseFrame) => void): () => void {
    const onFrame = (f: SseFrame): void => send(f);
    let set = this.listeners.get(sessionId);
    if (set == null) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(onFrame);
    const rows = this.deps.db
      .select({ seq: humanthinkEvents.seq, payload: humanthinkEvents.payload })
      .from(humanthinkEvents)
      .where(and(eq(humanthinkEvents.sessionId, sessionId), sql`${humanthinkEvents.seq} > ${after}`))
      .orderBy(humanthinkEvents.seq)
      .all();
    for (const r of rows) {
      send({ seq: r.seq, event: JSON.parse(r.payload) as HumanThinkEvent });
    }
    return () => {
      set!.delete(onFrame);
      if (set!.size === 0) this.listeners.delete(sessionId);
    };
  }

  /** live 帧分发：直推已 attach 的监听器（无订阅者时丢弃——delta 可丢，durable 有镜像兜底） */
  private forward(sessionId: string, frame: SseFrame): void {
    const set = this.listeners.get(sessionId);
    if (set != null) for (const fn of set) fn(frame);
  }
}

/**
 * serve 事件信封 → HumanThinkEvent（探针实证契约）。
 * tool 名由 tool.input.started 预填（同 callID）；未知名回退 'unknown'。
 */
export function toHumanThinkEvent(ev: ServeEnvelope, toolNames: Map<string, string>): HumanThinkEvent | null {
  const d = ev.data as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const callTool = (id: unknown): string => {
    const callID = str(id);
    if (callID == null) return 'unknown';
    return toolNames.get(callID) ?? 'unknown';
  };
  switch (ev.type) {
    case 'session.text.delta':
      return { type: 'text.delta', text: str(d.text) ?? '' };
    case 'session.text.ended':
      return { type: 'text.ended', text: str(d.text) ?? '', ...(str(d.assistantMessageID) != null ? { messageID: str(d.assistantMessageID)! } : {}) };
    case 'session.reasoning.delta':
      return { type: 'reasoning.delta', text: str(d.text) ?? '' };
    case 'session.reasoning.started':
      return { type: 'reasoning.started', ...(str(d.assistantMessageID) != null ? { messageID: str(d.assistantMessageID)! } : {}) };
    case 'session.reasoning.ended':
      return { type: 'reasoning.ended', text: str(d.text) ?? '', ...(str(d.assistantMessageID) != null ? { messageID: str(d.assistantMessageID)! } : {}) };
    case 'session.tool.input.started': {
      // 工具名供给（不转发不落库）
      const id = str(d.id);
      const name = str(d.name);
      if (id != null && name != null) toolNames.set(id, name);
      if (toolNames.size > 1000) {
        const first = toolNames.keys().next().value;
        if (first != null) toolNames.delete(first);
      }
      return null;
    }
    case 'session.tool.called':
      return { type: 'tool.called', callID: str(d.id) ?? '', tool: callTool(d.id), input: d.input };
    case 'session.tool.success':
      return { type: 'tool.success', callID: str(d.id) ?? '', tool: callTool(d.id) };
    case 'session.tool.failed':
      return {
        type: 'tool.failed',
        callID: str(d.id) ?? '',
        tool: callTool(d.id),
        ...(d.error != null && typeof d.error === 'object' ? { error: d.error as { type: string; message?: string } } : {}),
      };
    case 'session.tool.progress':
      return { type: 'tool.progress', callID: str(d.id) ?? '', tool: callTool(d.id) };
    case 'session.step.started':
      return { type: 'step.started', ...(str(d.assistantMessageID) != null ? { messageID: str(d.assistantMessageID)! } : {}) };
    case 'session.step.ended':
      return { type: 'step.ended', ...(str(d.finish) != null ? { finish: str(d.finish)! } : {}) };
    case 'permission.asked':
      return {
        type: 'permission.asked',
        requestID: str(d.id) ?? '',
        action: str(d.action) ?? 'unknown',
        resources: Array.isArray(d.resources) ? (d.resources as string[]) : [],
      };
    case 'permission.rejected':
      return { type: 'permission.rejected', ...(str(d.id) != null ? { requestID: str(d.id)! } : {}), ...(str(d.message) != null ? { message: str(d.message)! } : {}) };
    case 'permission.replied': {
      const decision = str(d.reply);
      return {
        type: 'permission_resolved',
        requestID: str(d.requestID) ?? '',
        ...(decision === 'once' || decision === 'always' || decision === 'reject' ? { decision } : {}),
      };
    }
    default:
      return null; // usage.updated/execution.*/inbox.* 等——不转发不落库
  }
}

/** HumanThinkEvent → UnifiedEvent 映射（S2b1 技术方案 6：session.* 语义并入统一事件流） */
export function mapToUnifiedEvent(ev: HumanThinkEvent): UnifiedEvent | null {
  switch (ev.type) {
    case 'text.delta':
      return { type: 'text-delta', text: ev.text };
    case 'text.ended':
      return { type: 'text-end' };
    case 'reasoning.started':
      return { type: 'reasoning', text: '', phase: 'started' };
    case 'reasoning.ended':
      return { type: 'reasoning', text: ev.text, phase: 'ended' };
    case 'tool.called':
      return { type: 'tool-call', tool: ev.tool };
    case 'tool.success':
      return { type: 'tool-result', tool: ev.tool, errored: false };
    case 'tool.failed':
      return { type: 'tool-result', tool: ev.tool, errored: true };
    case 'step.started':
      return { type: 'turn-start' };
    case 'step.ended':
      return { type: 'turn-end', ...(ev.finish != null ? { reason: ev.finish } : {}) };
    case 'permission_request':
      return { type: 'permission_request', requestID: ev.requestID, action: ev.action, resources: ev.resources, status: 'pending' };
    case 'permission_resolved':
      return {
        type: 'permission_request',
        requestID: ev.requestID,
        action: '',
        resources: [],
        status: 'resolved',
        ...(ev.decision != null ? { decision: ev.decision } : {}),
      };
    default:
      // reasoning.delta/tool.progress/step 之外的杂型与 message 对账行无统一事件流对应
      return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
