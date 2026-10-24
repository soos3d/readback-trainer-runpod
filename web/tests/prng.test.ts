import { describe, expect, test } from "vitest";
import { mulberry32 } from "@/lib/prng";

describe("mulberry32", () => {
  test("same seed yields the same first 5 values, all in [0, 1)", () => {
    const take5 = () => {
      const next = mulberry32(42);
      return Array.from({ length: 5 }, () => next());
    };
    const first = take5();
    expect(take5()).toEqual(first);
    expect(new Set(first).size).toBe(5);
    first.forEach((v) => expect(v >= 0 && v < 1).toBe(true));
  });

  test("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
