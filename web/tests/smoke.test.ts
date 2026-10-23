import "server-only";
import { expect, test } from "vitest";

test("vitest runs and server-only is stubbed", () => {
  expect(1 + 1).toBe(2);
});
