import { route } from "@/lib/route";
import { AIRPORTS, type AirportSummary } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// name = radio_name until airports.json carries a display name (DECISIONS.md, T13).
const SUMMARIES: AirportSummary[] = Object.entries(AIRPORTS).map(([icao, a]) => ({
  icao,
  radio_name: a.radio_name,
  name: a.radio_name,
}));

export const GET = route("/api/airports", async () => ({ body: SUMMARIES }));
