import { route, speech } from "@/lib/route";
import { warmUp } from "@/lib/runpod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("/api/warmup", async () => ({ body: await speech(warmUp) }));
