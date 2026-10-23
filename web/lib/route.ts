// Request plumbing shared by the six /api routes: rate limit, capped body read, error map, one log line.
import { ApiError, SpeechFailed, log, toResponse, type LogEntry } from "./errors";
import { checkRateLimit } from "./rateLimit";

const MAX_BODY_BYTES = 1_600_000;

export type Reply = { body: unknown } & Pick<LogEntry, "cache" | "fallback">;

const tooLarge = () => new ApiError(413, "payload_too_large", "Request body is over 1.6 MB", "web");

// Checks Content-Length before touching the body, then stops reading once the cap is passed,
// so a request without the header can't stream an unbounded body into memory.
async function readCapped(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    size += r.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The request body as JSON, size-capped. Malformed JSON is a 422. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await readCapped(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(422, "invalid_input", "Request body is not valid JSON", "web");
  }
}

/** Wraps a handler: rate limit first, ApiError/ZodError → status via toResponse, then one log line. */
export function route(name: string, handle: (req: Request) => Promise<Reply>) {
  return async (req: Request): Promise<Response> => {
    const started = performance.now();
    let res: Response;
    let meta: Pick<LogEntry, "cache" | "fallback"> = {};
    try {
      checkRateLimit(name, req);
      const { body, ...rest } = await handle(req);
      res = Response.json(body);
      meta = rest;
    } catch (err) {
      res = toResponse(err);
    }
    log({ route: name, status: res.status, latency_ms: Math.round(performance.now() - started), ...meta });
    return res;
  };
}

/** Runs a speech call; a rejected SDK call (network, missing env) becomes 502 speech_failed. */
export async function speech<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new SpeechFailed("speech worker unreachable");
  }
}
