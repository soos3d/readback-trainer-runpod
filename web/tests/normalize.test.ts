import { describe, expect, test } from "vitest";
import { normalize } from "@/lib/normalize";

describe("normalize §11.1", () => {
  test("number words, tree/fife/niner, nine", () => {
    expect(normalize("tree fife niner nine")).toEqual(["3599"]);
  });
  test("oh is 0 only between digits", () => {
    expect(normalize("squawk four five oh one")).toEqual(["squawk", "4501"]);
    expect(normalize("oh four five")).toEqual(["oh", "45"]);
    expect(normalize("four five oh")).toEqual(["45", "oh"]);
  });
  test("point and decimal between digits become a dot", () => {
    expect(normalize("one two one decimal eight five")).toEqual(["121.85"]);
    expect(normalize("at this point")).toEqual(["at", "this", "point"]);
  });
  test("phonetic letters incl. alfa, juliett, x-ray", () => {
    expect(normalize("alfa juliett x-ray xray juliet")).toEqual(["ajxxj"]);
  });
  test("punctuation, case, thousands separators", () => {
    expect(normalize("Climb, maintain 3,000. Departure 119.4.")).toEqual(["climb", "maintain", "3000", "departure", "119.4"]);
  });
  test("multi-digit Whisper tokens do not merge with neighbours", () => {
    expect(normalize("7000 10 minutes")).toEqual(["7000", "10", "minutes"]);
  });
  test("a callsign after a number starts a new run, with or without a comma", () => {
    expect(normalize("heading two eight zero, november niner one zero five five")).toEqual(["heading", "280", "n91055"]);
    expect(normalize("heading two eight zero november niner one zero five five")).toEqual(["heading", "280", "n91055"]);
  });
  test("a comma ends a run; N inside a tail does not", () => {
    expect(normalize("squawk four five two one, one two one point eight")).toEqual(["squawk", "4521", "121.8"]);
    expect(normalize("november one two november")).toEqual(["n12n"]);
  });
});
