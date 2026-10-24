import { afterEach, describe, expect, test, vi } from "vitest";
import { requireEnv } from "@/lib/env";

describe("requireEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("throws naming the missing var", () => {
    expect(() => requireEnv("NOPE")).toThrow("NOPE is not set; see web/.env.example");
  });

  test("returns a set value", () => {
    vi.stubEnv("SOME_KEY", "v");
    expect(requireEnv("SOME_KEY")).toBe("v");
  });
});
