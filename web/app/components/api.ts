// Same-origin fetch for the page. Every route answers errors as {error:{code,message,source}} (SPEC §12.4).
import type { ApiErrorBody } from "@/lib/schemas";
import type { Failure } from "../reducer";

export class RequestFailed extends Error {
  constructor(readonly failure: Failure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "RequestFailed";
  }
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (cause) {
    throw new RequestFailed({ status: 0, code: "network", message: "Network error — check your connection", source: "web" }, { cause });
  }
  // A non-JSON body only happens on proxy or network trouble; the status line below still names it.
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return json as T;
  const err = (json as Partial<ApiErrorBody> | null)?.error;
  throw new RequestFailed({
    status: res.status,
    code: err?.code ?? "internal",
    message: err?.message ?? `Request failed with HTTP ${res.status}`,
    source: err?.source ?? "web",
  });
}

export const get = <T>(path: string) => send<T>(path, { method: "GET" });

export const post = <T>(path: string, body?: unknown) =>
  send<T>(path, body === undefined
    ? { method: "POST" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function toFailure(e: unknown): Failure {
  if (e instanceof RequestFailed) return e.failure;
  return { status: 0, code: "internal", message: e instanceof Error ? e.message : String(e), source: "web" };
}
