import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, test } from 'vitest';
import { tickets } from '../src/db/schema.js';
import { createDatabase } from '../src/db/client.js';
import { TicketService } from '../src/domain/ticket-service.js';
import {
  buildWorkspaceFixture,
  createTestContext,
  captureError,
  type WorkspaceSpec,
} from './helpers.js';

const DRIZZLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

describe('建单挂载契约【S2w1 FR-3/FR-4】', () => {
  test('workspaceId 未知 → 422 WORKSPACE_UNKNOWN（HTTP）', async () => {
    const { app } = createTestContext();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: { type: 'TASK', title: 't', workspaceId: 'ghost-ws' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('WORKSPACE_UNKNOWN');
    expect(res.json().error.details?.join()).toContain('atd');
  });

  test('缺省 workspace=atd、缺省 repoRef=主仓 id 落库实际值（TicketVO 恒返回）', async () => {
    const { app } = createTestContext();
    const res = await app.inject({ method: 'POST', url: '/api/tickets', payload: { type: 'TASK', title: 't' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.workspaceId).toBe('atd');
    expect(body.repoRef).toBe('atd');
    // 非 TASK 单 repoRef 恒 null（STORY 无仓语义）
    const story = await app.inject({ method: 'POST', url: '/api/tickets', payload: { type: 'STORY', title: 's' } });
    expect(story.json().workspaceId).toBe('atd');
    expect(story.json().repoRef).toBeNull();
  });

  test('repoRef ∉ workspace repos → 422 REPO_REF_INVALID（details 含可选集）', async () => {
    const { app } = createTestContext();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: { type: 'TASK', title: 't', repoRef: 'nope-repo' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('REPO_REF_INVALID');
    expect(res.json().error.details?.join()).toContain('atd');
  });

  test('repoRef 非 TASK 单传入 → 422 REPO_REF_INVALID', async () => {
    const { app } = createTestContext();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: { type: 'STORY', title: 's', repoRef: 'atd' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('REPO_REF_INVALID');
  });

  test('多仓 workspace：合法 repoRef 落库、缺省主仓', () => {
    const repoA = mkdtempSync(path.join(tmpdir(), 'atdwr-'));
    const repoB = mkdtempSync(path.join(tmpdir(), 'atdwr-'));
    const specs: WorkspaceSpec[] = [
      { id: 'atd', name: 'ATD', repos: [{ id: 'repo-a', path: repoA, role: 'primary' }, { id: 'repo-b', path: repoB, role: 'readable' }] },
    ];
    const { service } = createTestContext({ workspaceSpecs: specs });
    const t1 = service.createTicket({ type: 'TASK', title: '主仓缺省' });
    expect(t1.workspaceId).toBe('atd');
    expect(t1.repoRef).toBe('repo-a');
    const t2 = service.createTicket({ type: 'TASK', title: '指向 B', repoRef: 'repo-b' });
    expect(t2.repoRef).toBe('repo-b');
  });

  test('parentId 强制继承父 workspace：异值 422 CROSS_WORKSPACE；不传则静默继承', () => {
    const ws2Repo = mkdtempSync(path.join(tmpdir(), 'atdwr-'));
    const specs: WorkspaceSpec[] = [
      { id: 'atd', name: 'ATD', repos: [{ id: 'atd', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
      { id: 'ws-two', name: '二号', repos: [{ id: 'w2', path: ws2Repo, role: 'primary' }] },
    ];
    const { service } = createTestContext({ workspaceSpecs: specs });
    const parent = service.createTicket({ type: 'STORY', title: '父', workspaceId: 'ws-two' });
    // 异值拒绝
    const err = captureError(() =>
      service.createTicket({ type: 'TASK', title: '子', parentId: parent.id, workspaceId: 'atd' }),
    );
    expect(err.code).toBe('CROSS_WORKSPACE');
    expect(err.details?.join()).toContain('ws-two');
    // 不传 → 继承父值（且 repoRef 按父 workspace 主仓解析）
    const child = service.createTicket({ type: 'TASK', title: '子', parentId: parent.id });
    expect(child.workspaceId).toBe('ws-two');
    expect(child.repoRef).toBe('w2');
    // 同值显式传入 → 放行
    const same = service.createTicket({ type: 'TASK', title: '同值子', parentId: parent.id, workspaceId: 'ws-two' });
    expect(same.workspaceId).toBe('ws-two');
  });
});

describe('依赖边同 workspace 约束【S2w1 FR-3】', () => {
  test('跨 workspace addDependency → 422 CROSS_WORKSPACE（指明两侧）', () => {
    const specs: WorkspaceSpec[] = [
      { id: 'atd', name: 'ATD', repos: [{ id: 'atd', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
      { id: 'other', name: '他域', repos: [{ id: 'o1', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
    ];
    const { service } = createTestContext({ workspaceSpecs: specs });
    const a = service.createTicket({ type: 'TASK', title: 'A' });
    const b = service.createTicket({ type: 'TASK', title: 'B', workspaceId: 'other' });
    const err = captureError(() => service.addDependency(b.id, a.id));
    expect(err.code).toBe('CROSS_WORKSPACE');
    expect(err.details?.join('\n')).toContain(`#${a.id}（atd）`);
    expect(err.details?.join('\n')).toContain(`#${b.id}（other）`);
    // 同 workspace 依赖不受影响
    const c = service.createTicket({ type: 'TASK', title: 'C' });
    expect(() => service.addDependency(c.id, a.id)).not.toThrow();
  });
});

describe('放行 repoRef 复校（user 通道）【S2w1 FR-4】', () => {
  test('建单后 yaml 漂移（registry 中该 repo 已移除）→ 放行 422 REPO_REF_DRIFTED 含修复指引', () => {
    const { service, db } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: '漂移单', repoRef: 'atd' });
    service.submitSpec(t.id, '# spec');
    expect(t.status).toBe('DRAFT');
    // 语义等价的「替换注入 registry」：同 db 上以漂移后的 registry 构造 service 放行
    const drifted = buildWorkspaceFixture([
      { id: 'atd', name: 'ATD', repos: [{ id: 'renamed', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
    ]);
    const driftedService = new TicketService(db, drifted.registry);
    const err = captureError(() =>
      driftedService.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }),
    );
    expect(err.code).toBe('REPO_REF_DRIFTED');
    expect(err.details?.join('\n')).toContain('yaml');
  });
});

describe('BLOCKER workspaceId 继承【D7 单点收口】', () => {
  test('createBlocker 从父单行继承 workspaceId，repoRef 恒 null', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: '卡点父' });
    service.submitSpec(t.id, '# spec');
    service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    service.transition(t.id, 'IN_PROGRESS', { actor: 'system' });
    service.transition(t.id, 'BLOCKED', { actor: 'system' });
    const blocker = service.createBlocker({ parentTicketId: t.id, reason: '外部卡点' });
    expect(blocker.workspaceId).toBe('atd');
    expect(blocker.repoRef).toBeNull();
  });
});

describe('workspace 查询 API【S2w1 FR-5】', () => {
  test('GET /api/workspaces：列表含 repos 明细/主仓/工单计数；GET /:id 详情与 404', async () => {
    const specs: WorkspaceSpec[] = [
      { id: 'atd', name: 'ATD', repos: [{ id: 'atd', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
      { id: 'demo', name: '演示域', repos: [{ id: 'd1', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }, { id: 'd2', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'readable' }] },
    ];
    const ctx = createTestContext({ workspaceSpecs: specs });
    ctx.service.createTicket({ type: 'TASK', title: '一' });
    ctx.service.createTicket({ type: 'TASK', title: '二' });
    ctx.service.createTicket({ type: 'TASK', title: '三', workspaceId: 'demo' });

    const list = await ctx.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.workspaces).toHaveLength(2);
    const atd = body.workspaces.find((w: { id: string }) => w.id === 'atd');
    expect(atd.ticketCount).toBe(2);
    expect(atd.primary).toBe('atd');
    expect(atd.repos[0].path).toBe(path.resolve(atd.repos[0].path)); // 绝对路径
    const demo = body.workspaces.find((w: { id: string }) => w.id === 'demo');
    expect(demo.ticketCount).toBe(1);
    expect(demo.repos.map((r: { id: string }) => r.id)).toEqual(['d1', 'd2']);

    const detail = await ctx.app.inject({ method: 'GET', url: '/api/workspaces/demo' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().workspace).toEqual(demo);
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/workspaces/ghost' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });

  test('GET /api/tickets?workspaceId= 可选过滤（不传=全量）', async () => {
    const specs: WorkspaceSpec[] = [
      { id: 'atd', name: 'ATD', repos: [{ id: 'atd', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
      { id: 'beta', name: '乙域', repos: [{ id: 'b1', path: mkdtempSync(path.join(tmpdir(), 'atdwr-')), role: 'primary' }] },
    ];
    const ctx = createTestContext({ workspaceSpecs: specs });
    ctx.service.createTicket({ type: 'TASK', title: '域内' });
    ctx.service.createTicket({ type: 'TASK', title: '乙域单', workspaceId: 'beta' });

    const all = (await ctx.app.inject({ method: 'GET', url: '/api/tickets' })).json();
    expect(all.items).toHaveLength(2);
    const onlyBeta = (await ctx.app.inject({ method: 'GET', url: '/api/tickets?workspaceId=beta' })).json();
    expect(onlyBeta.items).toHaveLength(1);
    expect(onlyBeta.items[0].title).toBe('乙域单');
    expect(onlyBeta.items[0].workspaceId).toBe('beta');
    // 未知 workspaceId → 空集（过滤语义，不报错）
    const none = (await ctx.app.inject({ method: 'GET', url: '/api/tickets?workspaceId=ghost' })).json();
    expect(none.items).toHaveLength(0);
  });
});

describe('存量归属：migration ADD COLUMN DEFAULT 语义【S2w1 FR-2】', () => {
  test('预建旧 schema 库（0000+0001）含数据行 → 全量 migrate 后 workspace_id 全部=atd', () => {
    // 旧 migration 目录：拷贝 0000/0001 sql 与 meta（journal 截断至前两项）
    const oldDir = mkdtempSync(path.join(tmpdir(), 'atdmig-'));
    mkdirSync(path.join(oldDir, 'meta'));
    for (const f of ['0000_harsh_power_pack.sql', '0001_s2a.sql', 'meta/0000_snapshot.json', 'meta/0001_snapshot.json']) {
      execSync(`cp ${JSON.stringify(path.join(DRIZZLE_DIR, f))} ${JSON.stringify(path.join(oldDir, f))}`);
    }
    const journal = JSON.parse(readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
    writeFileSync(
      path.join(oldDir, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    );

    // 预建旧 schema 库（无 workspace_id 列）+ 两行存量数据
    const dbFile = path.join(mkdtempSync(path.join(tmpdir(), 'atdold-')), 'old.db');
    const raw = new Database(dbFile);
    const oldDb = drizzle(raw);
    migrate(oldDb, { migrationsFolder: oldDir });
    raw.exec(
      `INSERT INTO tickets (type, title, status, created_at, updated_at) VALUES
        ('TASK', '旧任务单', 'DONE', 1, 1),
        ('STORY', '旧故事单', 'DRAFT', 2, 2)`,
    );
    raw.close();

    // 升级：createDatabase 走真实全量 migration（追加 0002）——存量行由 DEFAULT 归属 atd
    const db = createDatabase(dbFile);
    const rows = db.select().from(tickets).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.workspaceId === 'atd')).toBe(true);
    expect(rows.every((r) => r.repoRef === null)).toBe(true);
  });
});
