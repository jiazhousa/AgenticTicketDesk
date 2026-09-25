import { describe, expect, test } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ServeManager } from '../../src/humanthink/serve-manager.js';
import { createFakeServe } from './fake-serve.js';

/** 假子进程（pid 存在；崩溃注入经 emit('exit')） */
function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 111, exitCode: null, kill: () => true, stdio: [null, null, null] });
  return child;
}

function httpJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

describe('ServeManager 生命周期【S2b1 技术方案 1】', () => {
  test('start：健康探测通过 → ready；onReady 触发；端口注入渲染 argv/env', async () => {
    let child = fakeChild();
    const children: ChildProcess[] = [];
    let readyCount = 0;
    const mgr = new ServeManager({
      commandTemplate: ['opencode', 'serve', '--port', '{port}'],
      configDir: '/tmp/htcfg',
      cwd: '/tmp/htdata',
      startPort: 4900,
      spawnImpl: (argv, opts) => {
        expect(argv[3]).toMatch(/^49\d\d$/);
        expect(opts.env.OPENCODE_SERVER_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
        expect(opts.env.OPENCODE_CONFIG_DIR).toBe('/tmp/htcfg');
        // 环境合并（质量门 r1-c1）：子进程必须继承宿主 PATH——opencode 装在用户目录时缺 PATH 必然 ENOENT
        expect(opts.env.PATH).toBe(process.env.PATH);
        children.push(child);
        return child;
      },
      fetchImpl: (async () => httpJson({ location: { directory: '/tmp' }, data: [] })) as typeof fetch,
      onReady: () => {
        readyCount += 1;
      },
      restartBackoffMs: [10, 10, 10],
      healthTimeoutMs: 1000,
    });
    await expect(mgr.start()).resolves.toBe('ready');
    expect(mgr.currentState).toBe('ready');
    expect(readyCount).toBe(1);
    const handle = mgr.getHandle()!;
    expect(handle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:49\d\d$/);
    expect(handle.authHeader).toMatch(/^Basic /);
    mgr.stop();
    expect(mgr.currentState).toBe('stopped');
    expect(mgr.getHandle()).toBeNull();
    void child;
    void children;
  });

  test('健康探测失败（5s 窗口内无 HTTP 响应）→ 首启即 degraded + 后台退避重试', async () => {
    let child = fakeChild();
    const mgr = new ServeManager({
      commandTemplate: ['opencode', 'serve', '--port', '{port}'],
      configDir: '/d', cwd: '/d', startPort: 4900,
      spawnImpl: () => child,
      fetchImpl: (async () => {
        throw new Error('connection refused');
      }) as typeof fetch,
      restartBackoffMs: [5, 5, 5],
      healthTimeoutMs: 30,
    });
    await expect(mgr.start()).resolves.toBe('degraded');
    expect(mgr.getHandle()).toBeNull();
    // 三次退避全败 → 停留 degraded（不再重试）
    await new Promise((r) => setTimeout(r, 80));
    expect(mgr.currentState).toBe('degraded');
    mgr.stop();
  });

  test('就绪后崩溃：退避重启成功 → 回 ready + 再触发 onReady', async () => {
    const child = fakeChild();
    let healthy = true;
    let readyCount = 0;
    const mgr = new ServeManager({
      commandTemplate: ['opencode', 'serve', '--port', '{port}'],
      configDir: '/d', cwd: '/d', startPort: 4900,
      spawnImpl: () => child,
      fetchImpl: (async () => {
        if (!healthy) throw new Error('down');
        return httpJson({ data: [] });
      }) as typeof fetch,
      onReady: () => {
        readyCount += 1;
      },
      restartBackoffMs: [10],
      healthTimeoutMs: 200,
    });
    await expect(mgr.start()).resolves.toBe('ready');
    // 进程崩溃 + 短暂不可达一轮后恢复
    healthy = false;
    child.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 5));
    expect(mgr.currentState).not.toBe('ready');
    healthy = true;
    await new Promise((r) => setTimeout(r, 60));
    expect(mgr.currentState).toBe('ready');
    expect(readyCount).toBe(2);
    mgr.stop();
  });

  test('spawn 同步失败（命令不存在）→ 启动失败走重启链', async () => {
    const mgr = new ServeManager({
      commandTemplate: ['no-such-bin', 'serve', '--port', '{port}'],
      configDir: '/d', cwd: '/d', startPort: 4900,
      spawnImpl: () => {
        throw new Error('spawn ENOENT');
      },
      fetchImpl: (async () => httpJson({ data: [] })) as typeof fetch,
      restartBackoffMs: [5, 5, 5],
      healthTimeoutMs: 30,
    });
    await expect(mgr.start()).resolves.toBe('degraded');
    mgr.stop();
  });

  test('端口占用递补：起始端口被占时取下一个空闲', async () => {
    const { probeFreePort } = await import('../../src/humanthink/serve-manager.js');
    // 占住一个端口
    const net = await import('node:net');
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(4949, '127.0.0.1', r));
    const port = await probeFreePort(4949);
    expect(port).toBe(4950);
    await new Promise<void>((r) => blocker.close(() => r()));
    void createFakeServe; // 共享假件引用（同目录测试约定）
  });
});
