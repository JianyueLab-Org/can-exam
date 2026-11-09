/**
 * `GET /health` 的检查：外部可用性监控用。k8s 探针不指向这里。
 *
 * 结果在进程内缓存 10 秒，并发请求共用同一次检查。
 */

import { apiOrigin } from "./config";

export const CHECK_TIMEOUT_MS = 3000;
export const CACHE_MS = 10_000;

export type Check = () => Promise<void>;

export interface HealthResult {
  ok: boolean;
  body: { status: "ok" | "fail"; checks: Record<string, string> };
}

/** 上游的 `/health`，非 2xx 即失败。 */
export function upstreamCheck(origin: () => string): Check {
  return async () => {
    const res = await fetch(`${origin()}/health`, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`status ${res.status}`);
  };
}

function shortError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError")
      return "timeout";
    return err.message.slice(0, 120) || err.name;
  }
  return "error";
}

export function createHealth(
  checks: Record<string, Check>,
  now: () => number = Date.now,
) {
  let cached: { at: number; result: HealthResult } | undefined;
  let inflight: Promise<HealthResult> | undefined;

  async function run(): Promise<HealthResult> {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch (err) {
          const msg = shortError(err);
          console.error(`health check ${name} failed: ${msg}`);
          return [name, msg] as const;
        }
      }),
    );
    const ok = entries.every(([, v]) => v === "ok");
    return {
      ok,
      body: { status: ok ? "ok" : "fail", checks: Object.fromEntries(entries) },
    };
  }

  return function health(): Promise<HealthResult> {
    if (cached && now() - cached.at < CACHE_MS)
      return Promise.resolve(cached.result);
    inflight ??= run()
      .then((result) => {
        cached = { at: now(), result };
        return result;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
}

export const health = createHealth({ "can-api": upstreamCheck(apiOrigin) });
