// Per-IP fixed-window rate limits (SPEC §13.4): 30/min across all routes, 6/min on the GPU routes.
import { ApiError } from "./errors";

const WINDOW_MS = 60_000;
const GPU_ROUTE_LIMIT: Readonly<Record<string, number>> = { "/api/speak": 6, "/api/attempt": 6 };
const MAX_KEYS = 10_000;

// ponytail: one in-process Map, as §13.2 allows (one Pod process). Move to Redis if the app scales out.
const windows = new Map<string, { start: number; count: number }>();

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function overallLimit(): number {
  const raw = process.env.RATE_LIMIT_PER_MIN;
  if (!raw) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`RATE_LIMIT_PER_MIN must be a positive integer, got "${raw}"`);
  return n;
}

function sweep(now: number): void {
  if (windows.size < MAX_KEYS) return;
  for (const [key, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(key);
}

// Counts one request against `key`; false once the window already holds `limit` requests.
function allow(key: string, limit: number, now: number): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    sweep(now);
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  if (w.count >= limit) return false;
  windows.set(key, { start: w.start, count: w.count + 1 });
  return true;
}

/** Throws 429 rate_limited when this IP is over the overall or the per-route limit. */
export function checkRateLimit(route: string, req: Request, now = Date.now()): void {
  const ip = clientIp(req);
  const gpuLimit = GPU_ROUTE_LIMIT[route];
  const ok = allow(`all:${ip}`, overallLimit(), now) && (gpuLimit === undefined || allow(`${route}:${ip}`, gpuLimit, now));
  if (!ok) throw new ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.", "web");
}
