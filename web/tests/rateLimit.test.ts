import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Fresh module per test: the rate-limit windows are a module-level Map.
let checkRateLimit: typeof import("@/lib/rateLimit").checkRateLimit;
beforeEach(async () => {
  vi.resetModules();
  ({ checkRateLimit } = await import("@/lib/rateLimit"));
});
afterEach(() => vi.unstubAllEnvs());

const from = (ip: string) => new Request("http://localhost/api/speak", { headers: { "x-forwarded-for": ip } });

describe("checkRateLimit", () => {
  test("the 7th GPU call in a minute throws 429; the window resets after 60 s", () => {
    for (let i = 0; i < 6; i++) checkRateLimit("/api/speak", from("203.0.113.1"), 1_000);
    expect(() => checkRateLimit("/api/speak", from("203.0.113.1"), 59_999)).toThrow(
      expect.objectContaining({ status: 429, code: "rate_limited" }),
    );
    expect(() => checkRateLimit("/api/speak", from("203.0.113.1"), 61_000)).not.toThrow();
  });

  test("a bad RATE_LIMIT_PER_MIN fails fast instead of disabling the limit", () => {
    vi.stubEnv("RATE_LIMIT_PER_MIN", "0");
    expect(() => checkRateLimit("/api/grade", from("203.0.113.2"), 0)).toThrow(
      'RATE_LIMIT_PER_MIN must be a positive integer, got "0"',
    );
  });
});
