import { describe, expect, test } from "vitest";
import { endHeading, runwayInUse } from "@/lib/runway";

const single = [{ id: "07/25", alignment: 66 }];
const parallel = [
  { id: "13L/31R", alignment: 128 },
  { id: "13R/31L", alignment: 128 },
  { id: "07/25", alignment: 66 },
];

describe("runwayInUse", () => {
  test("080 at 9 with 07/25 → 07", () => {
    expect(runwayInUse({ windDirTrue: 80, windKt: 9, runways: single, calmRunway: "25" })).toBe("07");
  });

  test("260 at 12 → 25", () => {
    expect(runwayInUse({ windDirTrue: 260, windKt: 12, runways: single, calmRunway: "07" })).toBe("25");
  });

  test("3 kt → calm runway", () => {
    expect(runwayInUse({ windDirTrue: 80, windKt: 3, runways: single, calmRunway: "25" })).toBe("25");
  });

  test("VRB → calm runway", () => {
    expect(runwayInUse({ windDirTrue: "VRB", windKt: 15, runways: single, calmRunway: "25" })).toBe("25");
  });

  test("wraps across north: 350 picks 01 over 19", () => {
    const rwy = [{ id: "01/19", alignment: 10 }];
    expect(runwayInUse({ windDirTrue: 350, windKt: 10, runways: rwy, calmRunway: "19" })).toBe("01");
  });

  test("L/R/C suffixes kept", () => {
    expect(runwayInUse({ windDirTrue: 310, windKt: 10, runways: parallel, calmRunway: "07" })).toBe("31R");
    const center = [{ id: "18C/36C", alignment: 180 }];
    expect(runwayInUse({ windDirTrue: 170, windKt: 8, runways: center, calmRunway: "36C" })).toBe("18C");
  });

  test("tie goes to the earliest end in runway order", () => {
    expect(runwayInUse({ windDirTrue: 130, windKt: 10, runways: parallel, calmRunway: "07" })).toBe("13L");
  });

  test("approach restriction picks closest listed end", () => {
    // Wind favors 31R, but only 25 and 13R have approaches.
    const allowedEnds = ["25", "13R"];
    expect(runwayInUse({ windDirTrue: 300, windKt: 10, runways: parallel, calmRunway: "07", allowedEnds })).toBe("25");
  });

  test("calm with approaches: calm runway if listed, else listed end nearest its heading", () => {
    const args = { windDirTrue: "VRB" as const, windKt: 2, runways: parallel, calmRunway: "07" };
    expect(runwayInUse({ ...args, allowedEnds: ["31L", "07"] })).toBe("07");
    expect(runwayInUse({ ...args, allowedEnds: ["31L", "13R"] })).toBe("13R");
  });

  test("throws when no allowed end exists on the runways", () => {
    expect(() =>
      runwayInUse({ windDirTrue: 80, windKt: 9, runways: single, calmRunway: "07", allowedEnds: ["09"] }),
    ).toThrow(/09/);
  });

  test("throws on empty runway list", () => {
    expect(() => runwayInUse({ windDirTrue: 80, windKt: 9, runways: [], calmRunway: "07" })).toThrow();
  });
});

describe("endHeading", () => {
  test("runway number × 10, suffix ignored", () => {
    expect(endHeading("07")).toBe(70);
    expect(endHeading("13L")).toBe(130);
    expect(endHeading("36C")).toBe(360);
  });

  test("throws on a non-runway id", () => {
    expect(() => endHeading("TODO")).toThrow(/TODO/);
  });
});
