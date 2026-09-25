import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * humanthink serve 配置生成（S2b1 技术方案 2）。
 * 纯函数集：解析用户全局配置（白名单提取）+ 按 workspace 集生成 agent 权限规则；
 * 写目标仅 {dataDir}/opencode-config/opencode.json（幂等重写，绝不写其他任何路径）。
 */

/** 权限规则形状（探针 P1b 定案：{action, resource, effect}，effect ∈ ask/allow/deny） */
export type PermissionRule = { action: string; resource: string; effect: 'ask' | 'allow' | 'deny' };

/** workspace 视野输入（规则生成的唯一依据；serve 生命周期内 workspace 集不变） */
export type VisionWorkspace = {
  id: string;
  repos: Array<{ path: string; role: 'primary' | 'readable' }>;
};

/** 从用户全局配置提取的白名单内容（model/providers） */
export type UserGlobalExtract = { model?: string; providers?: Record<string, unknown> };

/** 用户全局配置固定读取位（V2 约定目录），opencode.json 优先于 opencode.jsonc */
export function userGlobalConfigPath(): string | null {
  const dir = path.join(homedir(), '.config', 'opencode');
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * 剥除 JSONC 注释（// 行注释与 /* 块注释，字符串字面量内的注释符不剥）。
 * 不做完整语法校验——解析失败由调用方按 JSON.parse 报错处置。
 */
export function stripJsonc(raw: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // 转义字符原样保留（含其后一个字符）
        if (i + 1 < raw.length) out += raw[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 解析用户全局配置原文并做白名单提取。
 * - 复制键白名单={model, providers}（providers 原样含凭据——dataDir 本地文件不入仓）
 * - V1 键形（单数 provider 的 map 形态）提取等价语义到 providers，绝不原样复制触发键
 * - 禁入键（单数 agent/provider/permission 及全部 V1 键）永不进入返回值
 */
export function extractUserGlobal(raw: string | null): UserGlobalExtract {
  if (raw == null || raw.trim() === '') return {};
  let doc: unknown;
  try {
    doc = JSON.parse(stripJsonc(raw));
  } catch {
    // 用户全局损坏时不提取（仅生成 agents 段，模型缺失风险由冒烟暴露）
    return {};
  }
  if (typeof doc !== 'object' || doc === null) return {};
  const rec = doc as Record<string, unknown>;
  const out: UserGlobalExtract = {};
  if (typeof rec.model === 'string') out.model = rec.model;
  if (isPlainObject(rec.providers)) out.providers = rec.providers;
  else if (isPlainObject(rec.provider)) out.providers = rec.provider; // V1 单数键等价语义提取
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 生成单个 workspace 的 agent 权限规则序列（探针 P1b 定案五规则，顺序硬编码）：
 * ① catch-all ask 强制首条（本二进制无匹配默认=allow，无它则三档语义崩塌）
 * ② external_directory deny /**（视野外绝对路径一律系统级拒绝）
 * ③ read allow *（会话目录内相对路径读自由）
 * ④⑤ per readable 仓：external_directory 与 read 各一条 <绝对路径>/* allow
 *    （findLast 后置胜出——置于 deny 之后放行 readable 仓，实测形态）
 */
export function buildAgentRules(ws: VisionWorkspace): PermissionRule[] {
  const rules: PermissionRule[] = [
    { action: '*', resource: '*', effect: 'ask' },
    { action: 'external_directory', resource: '/**', effect: 'deny' },
    { action: 'read', resource: '*', effect: 'allow' },
  ];
  for (const repo of ws.repos) {
    if (repo.role !== 'readable') continue;
    const abs = path.resolve(repo.path);
    rules.push({ action: 'external_directory', resource: `${abs}/*`, effect: 'allow' });
    rules.push({ action: 'read', resource: `${abs}/*`, effect: 'allow' });
  }
  return rules;
}

/**
 * 生成完整 serve 配置对象：白名单提取结果 + 每 workspace 一个动态 agent
 * （agents.atd-ht-{workspaceId}，permissions=五规则序列）。
 */
export function buildServeConfig(user: UserGlobalExtract, workspaces: VisionWorkspace[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (user.model != null) config.model = user.model;
  if (user.providers != null) config.providers = user.providers;
  const agents: Record<string, { permissions: PermissionRule[] }> = {};
  for (const ws of workspaces) {
    agents[`atd-ht-${ws.id}`] = { permissions: buildAgentRules(ws) };
  }
  config.agents = agents;
  return config;
}

/** 生成目录内配置文件的唯一写入口（启动幂等重写=整文件覆盖） */
export function writeServeConfig(configDir: string, config: Record<string, unknown>): string {
  mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, 'opencode.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

/** 读取用户全局配置原文（固定全局位；不存在返回 null） */
export function readUserGlobalRaw(): string | null {
  const file = userGlobalConfigPath();
  if (file == null) return null;
  return readFileSync(file, 'utf8');
}
