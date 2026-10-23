// The one error shape (SPEC §12.4) and the one server log line.
import { ZodError } from "zod";
import type { ApiErrorBody, ErrorCode, ErrorSource } from "./schemas";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly source: ErrorSource,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SpeechWarming extends ApiError {
  constructor(message = "Warming up the GPU (first call can take a minute)") {
    super(503, "speech_warming", message, "speech");
  }
}

export class SpeechFailed extends ApiError {
  constructor(message = "Voice unavailable. Type your readback.") {
    super(502, "speech_failed", message, "speech");
  }
}

const body = (code: ErrorCode, message: string, source: ErrorSource): ApiErrorBody => ({
  error: { code, message, source },
});

function describeZod(err: ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

export function toResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(body(err.code, err.message, err.source), { status: err.status });
  }
  if (err instanceof ZodError) {
    return Response.json(body("invalid_input", describeZod(err), "web"), { status: 422 });
  }
  // ponytail: unknown errors return a generic 500 and are not logged (log() carries no message
  // field by rule). Add a redacted error-name field to log() if 500s need diagnosing.
  return Response.json(body("internal", "Unexpected server error", "web"), { status: 500 });
}

export type LogEntry = {
  route: string;
  status: number;
  latency_ms: number;
  cache?: "hit" | "miss" | "stale";
  fallback?: boolean;
};

// Copies only the allowed fields so nothing else can reach the log.
export function log({ route, status, latency_ms, cache, fallback }: LogEntry): void {
  const line = JSON.stringify({ route, status, latency_ms, cache, fallback });
  if (status >= 500) console.error(line);
  else console.info(line);
}
