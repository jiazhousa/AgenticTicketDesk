import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { finishFromExit, mapOpencodeEvents, parseLine } from '@atd/worker-opencode';
import type { UnifiedEvent } from '@atd/worker-core';

export type RoundResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** stdout 中出现过 finish 语义（退出码 0 时由编排补记） */
  hadFinish: boolean;
  spawnError?: string;
};

export type StartedRun = { pid: number; done: Promise<RoundResult> };

/**
 * 渲染命令模板：先按空白拆 token 再整体替换变量——值含空格不二次拆分（参数数组语义，
 * 不经 shell，无注入面）。
 */
export function renderTemplate(
  command: string,
  vars: { worktree: string; prompt: string },
): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map((token) => token.replaceAll('{{worktree}}', vars.worktree).replaceAll('{{prompt}}', vars.prompt));
}

/** 追加写（失败仅记录，不中断流处理） */
function appendFd(fd: number, text: string): void {
  try {
    writeSync(fd, text);
  } catch (err) {
    console.error('[atd-execution] 日志写入失败', err);
  }
}

/**
 * 发起一轮执行：spawn（detached 进程组）→ stdout 逐行写 raw JSONL + 映射后写 events JSONL
 * （append 不覆盖，MUST-5）→ 超时杀进程组 SIGTERM→3s→SIGKILL → exit 汇总。
 * raw 首行为执行元数据（command/env 注入摘要/基线/轮次/超时——MUST-2 审计载体）。
 * spawn 同步失败（参数非法等）直接抛出，由调用方按 pre-spawn 失败处置。
 */
export function startRun(opts: {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  rawPath: string;
  eventsPath: string;
  meta: Record<string, unknown>;
  timeoutMs: number;
}): StartedRun {
  const rawFd = openSync(opts.rawPath, 'a');
  const eventsFd = openSync(opts.eventsPath, 'a');
  appendFd(rawFd, `${JSON.stringify({ meta: true, ...opts.meta })}\n`);

  const child: ChildProcess = spawn(opts.argv[0], opts.argv.slice(1), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let hadFinish = false;
  let skippedLines = 0;
  const stdoutRl = createInterface({ input: child.stdout! });
  stdoutRl.on('line', (line: string) => {
    appendFd(rawFd, `${line}\n`);
    const parsed = parseLine(line);
    if (parsed.kind !== 'json') {
      if (line.trim()) skippedLines += 1;
      return;
    }
    for (const ev of mapOpencodeEvents(parsed.value)) {
      if (ev.type === 'finish') hadFinish = true;
      appendFd(eventsFd, `${JSON.stringify(ev)}\n`);
    }
  });
  const stderrRl = createInterface({ input: child.stderr! });
  stderrRl.on('line', (line: string) => {
    appendFd(rawFd, `${line}\n`);
  });

  // 超时：杀整个进程组（detached 使子进程为组长，孙进程同组）SIGTERM → 3s → SIGKILL
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  const killGroup = (sig: NodeJS.Signals): void => {
    if (child.pid == null) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      // 进程组已消亡
    }
  };
  if (opts.timeoutMs > 0) {
    killTimer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      forceTimer = setTimeout(() => killGroup('SIGKILL'), 3000);
      forceTimer.unref();
    }, opts.timeoutMs);
    killTimer.unref();
  }

  let closed = false;
  const closeFds = (): void => {
    if (closed) return;
    closed = true;
    closeSync(rawFd);
    closeSync(eventsFd);
  };

  const done = new Promise<RoundResult>((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      stdoutRl.close();
      stderrRl.close();
      // 退出码 0 → 补记 finish(success) 事件（统一事件流收尾语义）
      if (code === 0) {
        hadFinish = true;
        for (const ev of finishFromExit(code)) {
          appendFd(eventsFd, `${JSON.stringify(ev)}\n`);
        }
      }
      appendFd(
        rawFd,
        `${JSON.stringify({
          meta: true,
          exit: true,
          pid: child.pid,
          exitCode: code,
          signal,
          timedOut,
          hadFinish,
          skippedLines,
        })}\n`,
      );
      closeFds();
      resolve({ exitCode: code, signal, timedOut, hadFinish });
    });
    child.on('error', (err) => {
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      stdoutRl.close();
      stderrRl.close();
      appendFd(
        rawFd,
        `${JSON.stringify({
          meta: true,
          exit: true,
          pid: child.pid,
          exitCode: null,
          signal: null,
          timedOut: false,
          hadFinish,
          skippedLines,
          spawnError: String(err),
        })}\n`,
      );
      closeFds();
      resolve({ exitCode: null, signal: null, timedOut: false, hadFinish, spawnError: String(err) });
    });
  });

  return { pid: child.pid ?? -1, done };
}
