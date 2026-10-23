import { readJson, route, speech } from "@/lib/route";
import { synthesize } from "@/lib/runpod";
import { SpeakRequest } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("/api/speak", async (req) => {
  const { text } = SpeakRequest.parse(await readJson(req));
  return { body: await speech(() => synthesize(text)) };
});
