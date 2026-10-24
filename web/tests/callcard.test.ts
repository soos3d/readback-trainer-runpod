import { describe, expect, it } from "vitest";
import { chips } from "@/app/components/CallCard";
import type { Scenario } from "@/lib/schemas";

type FlightSource = Scenario["provenance"]["flight"];
const flightChip = (flight: FlightSource) =>
  chips({ callsign: { tail: "N6758H" }, provenance: { weather: { source: "live" }, flight } } as unknown as Scenario)[1];

describe("CallCard flight chip", () => {
  it("live OpenSky flight reads real, with tail and date", () => {
    expect(flightChip({ source: "opensky", date: "2026-10-23" })).toEqual({ label: "Flight: real, N6758H on 2026-10-23", ok: true });
  });

  it("cached real flight reads cached, with tail and date", () => {
    expect(flightChip({ source: "cached", date: "2026-10-23" })).toEqual({ label: "Flight: cached, N6758H on 2026-10-23", ok: false });
  });

  it("synthetic flight reads made up", () => {
    expect(flightChip({ source: "synthetic" })).toEqual({ label: "Flight: made up", ok: false });
  });
});
