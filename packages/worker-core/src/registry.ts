import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProfile, type WorkerProfile } from './profile.js';

/**
 * Worker 生命周期接口位（HarnessV1 语义子集）。
 * S2a 的 task 模式由编排层以 spawn+wait+kill 实现；interactive 模式与 Runtime 实现随后续版本接入。
 */
export interface WorkerRuntime {
  /** 发起一轮 prompt 执行（interactive 模式下为流式交互回合） */
  doPromptTurn(input: { prompt: string; worktree: string }): Promise<void>;
  /** 停止当前执行 */
  doStop(): Promise<void>;
  /** 销毁 worker 实例（释放资源） */
  doDestroy(): Promise<void>;
}

/** 注册表：加载/持有/查询 worker profile */
export class WorkerRegistry {
  private readonly byId = new Map<string, WorkerProfile>();

  /** 注册单个 profile；id 冲突报错 */
  register(profile: WorkerProfile): void {
    if (this.byId.has(profile.id)) {
      throw new Error(`worker id 冲突：${profile.id} 已注册`);
    }
    this.byId.set(profile.id, profile);
  }

  get(id: string): WorkerProfile | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): WorkerProfile[] {
    return [...this.byId.values()];
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }
}

/** 加载目录下全部 *.yaml/*.yml 为 profile；目录不存在时返回空注册表 */
export function loadRegistry(dir: string): WorkerRegistry {
  const registry = new WorkerRegistry();
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch {
    return registry;
  }
  for (const file of files) {
    const full = join(dir, file);
    const profile = validateProfile(readFileSync(full, 'utf8'), full);
    registry.register(profile);
  }
  return registry;
}
