import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

/**
 * humanthink 常驻 serve 托管（S2b1 技术方案 1）。
 * ATD 启动 → spawn serve（独立端口/密码/配置目录）→ 健康探测 → ready；
 * 崩溃重启（退避 3 次转 degraded：humanthink 端点 503，工单功能不受影响）；
 * 清理挂 Fastify onClose。deps 注入 spawn/fetch/now（测试 seam）。
 */

export type ServeState = 'idle' | 'starting' | 'ready' | 'degraded' | 'stopped';

/** serve 访问句柄（facade/事件流消费；state=ready 时非空） */
export type ServeHandle = {
  baseUrl: string;
  /** Basic auth 头（密码仅内存与子进程 env，不落任何文件） */
  authHeader: string;
  port: number;
};

export type ServeManagerDeps = {
  /** serve 命令 token 模板（含 {port} 占位；端口探测递补后渲染为实际参数数组） */
  commandTemplate: string[];
  /** 生成的配置目录（OPENCODE_CONFIG_DIR 指向；config-gen 产物） */
  configDir: string;
  /** serve 进程 cwd */
  cwd: string;
  /** 起始端口（占用向后递补，连续探测 8 个） */
  startPort: number;
  /** spawn seam（缺省 node:child_process spawn，detached 进程组） */
  spawnImpl?: (argv: string[], opts: { cwd: string; env: Record<string, string> }) => ChildProcess;
  /** fetch seam */
  fetchImpl?: typeof fetch;
  /** 时钟注入 */
  now?: () => number;
  /** ready 回调（serve 首次就绪与崩溃重启成功均触发——事件流重订阅钩子） */
  onReady?: () => void;
  /** 日志（缺省 console） */
  log?: (msg: string) => void;
  /** 健康探测窗口 ms（缺省 5000）与重启退避序列 ms（缺省 1000/2000/4000 三次） */
  healthTimeoutMs?: number;
  restartBackoffMs?: number[];
};

export class ServeManager {
  private child: ChildProcess | null = null;
  private state: ServeState = 'idle';
  private handle: ServeHandle | null = null;
  private password = '';
  private restartTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private restartAttempts = 0;
  private stopped = false;

  constructor(private readonly deps: ServeManagerDeps) {}

  get currentState(): ServeState {
    return this.state;
  }

  /** 当前访问句柄（非 ready 态返回 null） */
  getHandle(): ServeHandle | null {
    return this.state === 'ready' ? this.handle : null;
  }

  private log(msg: string): void {
    (this.deps.log ?? ((m) => console.log(`[atd-humanthink] ${m}`)))(msg);
  }

  private fetch(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  /**
   * 启动：端口探测（占用递补）→ spawn（独立密码仅 env）→ 健康探测（authed GET /api/agent，
   * 收到任意 HTTP 状态即视为存活；5s 窗口）。返回首启结果；后续崩溃重启在本类内部
   * 异步退避循环，不阻塞调用方。
   */
  async start(): Promise<ServeState> {
    if (this.state !== 'idle') return this.state;
    this.stopped = false;
    this.state = 'starting';
    const ok = await this.launchOnce();
    if (ok) {
      this.state = 'ready';
      this.restartAttempts = 0;
      this.deps.onReady?.();
      return this.state;
    }
    // 首启失败进入后台重启退避循环；对外状态即时转 degraded（端点 503），重启成功再回 ready
    this.state = 'degraded';
    this.scheduleRestart();
    return this.state;
  }

  /** 单次拉起：探测空闲端口 → spawn → 健康探测窗口内轮询 */
  private async launchOnce(): Promise<boolean> {
    const port = await probeFreePort(this.deps.startPort);
    if (port == null) {
      this.log(`端口 ${this.deps.startPort} 起 8 个连续被占用，放弃本次拉起`);
      return false;
    }
    const argv = this.deps.commandTemplate.map((token) => token.replaceAll('{port}', String(port)));
    this.password = randomBytes(24).toString('hex');
    const env: Record<string, string> = {
      OPENCODE_SERVER_PASSWORD: this.password,
      OPENCODE_CONFIG_DIR: this.deps.configDir,
    };
    const spawnFn = this.deps.spawnImpl ?? ((argv, o) => spawn(argv[0], argv.slice(1), { ...o, detached: true, stdio: 'ignore' }));
    let child: ChildProcess;
    try {
      child = spawnFn(argv, { cwd: this.deps.cwd, env });
    } catch (err) {
      this.log(`serve spawn 失败：${(err as Error).message}`);
      return false;
    }
    if (child.pid == null) {
      this.log('serve spawn 未获得 pid（命令不存在或无执行权限）');
      return false;
    }
    this.child = child;
    this.handle = {
      baseUrl: `http://127.0.0.1:${port}`,
      authHeader: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`,
      port,
    };
    child.once('exit', (code, signal) => {
      if (this.stopped || this.state === 'stopped') return;
      this.log(`serve 进程退出（code=${code} signal=${signal}），进入重启退避`);
      this.onCrashed();
    });
    child.once('error', (err) => {
      if (this.stopped || this.state === 'stopped') return;
      this.log(`serve 进程错误：${err.message}`);
      this.onCrashed();
    });
    return this.probeHealthy();
  }

  /** 健康探测：窗口内轮询 authed GET /api/agent，收到任意 HTTP 响应即存活（空列表正常） */
  private async probeHealthy(): Promise<boolean> {
    const deadline = (this.deps.now ?? Date.now)() + (this.deps.healthTimeoutMs ?? 5000);
    const url = `${this.handle!.baseUrl}/api/agent`;
    while ((this.deps.now ?? Date.now)() < deadline) {
      if (this.child == null || this.child.exitCode != null) return false;
      try {
        const res = await this.fetch()(url, { headers: { authorization: this.handle!.authHeader } });
        // 任意 HTTP 状态都证明端口已监听（401 等异常态记日志但视为存活，由后续请求暴露问题）
        if (!res.ok) this.log(`健康探测返回非 2xx：HTTP ${res.status}`);
        return true;
      } catch {
        const remain = deadline - (this.deps.now ?? Date.now)();
        if (remain > 0) await sleep(Math.min(500, remain));
      }
    }
    this.log('健康探测超时（窗口内未监听）');
    return false;
  }

  /** 崩溃处置：就绪态崩溃与健康探测失败统一走重启退避（退避 3 次转 degraded） */
  private onCrashed(): void {
    if (this.state === 'ready') this.state = 'degraded';
    this.child = null;
    this.handle = null;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer != null) return;
    const backoff = this.deps.restartBackoffMs ?? [1000, 2000, 4000];
    if (this.restartAttempts >= backoff.length) {
      this.log(`连续 ${backoff.length} 次重启失败，转 degraded（不再自动重试；重启 ATD 恢复）`);
      this.state = 'degraded';
      return;
    }
    const wait = backoff[this.restartAttempts];
    this.restartAttempts += 1;
    this.log(`第 ${this.restartAttempts} 次重启（退避 ${wait}ms）`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.restartTick();
    }, wait);
    this.restartTimer.unref?.();
  }

  private async restartTick(): Promise<void> {
    if (this.stopped) return;
    const ok = await this.launchOnce();
    if (ok) {
      this.state = 'ready';
      this.restartAttempts = 0;
      this.log('serve 重启成功');
      this.deps.onReady?.();
      return;
    }
    this.child = null;
    this.handle = null;
    this.scheduleRestart();
  }

  /** 停止：杀整个进程组 SIGTERM → 3s → SIGKILL；清定时器（Fastify onClose 调用） */
  stop(): void {
    this.stopped = true;
    this.state = 'stopped';
    if (this.restartTimer != null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    this.handle = null;
    if (child?.pid == null) return;
    const killGroup = (sig: NodeJS.Signals): void => {
      try {
        process.kill(-child.pid!, sig);
      } catch {
        // 进程组已消亡
      }
    };
    killGroup('SIGTERM');
    this.killTimer = setTimeout(() => killGroup('SIGKILL'), 3000);
    this.killTimer.unref?.();
  }
}

/** 探测空闲端口：从 start 起连续 8 个，返回第一个可监听者（全占用返回 null） */
export function probeFreePort(start: number): Promise<number | null> {
  const tries = Array.from({ length: 8 }, (_, i) => start + i);
  return new Promise((resolve) => {
    const attempt = (idx: number): void => {
      if (idx >= tries.length) return resolve(null);
      const port = tries[idx];
      const srv = net.createServer();
      srv.once('error', () => {
        srv.close();
        attempt(idx + 1);
      });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, '127.0.0.1');
    };
    attempt(0);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
