/**
 * Локальный Worker для end-to-end проверок: настоящий wrangler dev поверх
 * настоящей D1 (SQLite на диске). Моков нет намеренно — то, что здесь
 * проверяется, живёт в SQL-условиях и транзакциях, а мок их не воспроизведёт.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const WORKERS_DIR = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(WORKERS_DIR, '..');
const CONFIG = path.join(WORKERS_DIR, 'wrangler.jsonc');

export const BOT_TOKEN = 'local-dev-bot-token';
export const PORT = Number(process.env.E2E_PORT ?? 8788);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const wrangler = (args: string[]) =>
  spawnSync('npx', ['wrangler', ...args, '--config', CONFIG], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });

/** Прямой SQL мимо API — им проверяется то, что через API не увидеть. */
export function sql(command: string): string {
  const result = wrangler(['d1', 'execute', 'karma-builder', '--local', '--json', '--command', command]);
  if (result.status !== 0) {
    throw new Error(`d1 execute failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function sqlRows<T>(command: string): T[] {
  const out = sql(command);
  const start = out.indexOf('[');
  if (start < 0) return [];
  const parsed = JSON.parse(out.slice(start)) as { results?: T[] }[];
  return parsed[0]?.results ?? [];
}

/** Чистая база на каждый прогон: тесты не должны зависеть от прошлых запусков. */
export function resetDatabase(): void {
  sql(
    'DELETE FROM reviews; DELETE FROM review_tokens; DELETE FROM deeds; DELETE FROM friendships; DELETE FROM users;',
  );
}

let child: ChildProcess | null = null;

export async function startWorker(): Promise<void> {
  wrangler(['d1', 'migrations', 'apply', 'karma-builder', '--local']);
  resetDatabase();

  child = spawn(
    'npx',
    ['wrangler', 'dev', '--config', CONFIG, '--port', String(PORT), '--inspector-port', '0'],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );

  const logs: string[] = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev упал:\n${logs.join('')}`);
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // ещё поднимается
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`wrangler dev не поднялся за 60 с:\n${logs.join('')}`);
}

export async function stopWorker(): Promise<void> {
  if (!child) return;
  child.kill('SIGTERM');
  child = null;
  // Порт освобождается не мгновенно; следующий прогон иначе упадёт на EADDRINUSE.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

export interface ApiResponse<T = Record<string, never>> {
  status: number;
  body: T;
}

export async function api<T = Record<string, never>>(
  method: string,
  path: string,
  options: { initData?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.initData ? { 'X-Telegram-Init-Data': options.initData } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body: body as T };
}
