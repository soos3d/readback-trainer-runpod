import { grade } from "@/lib/grader";
import { readJson, route, speech } from "@/lib/route";
import { transcribe } from "@/lib/runpod";
import { AttemptRequest } from "@/lib/schemas";
import { checkWav } from "@/lib/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("/api/attempt", async (req) => {
  const { scenario, audio_wav_b64 } = AttemptRequest.parse(await readJson(req));
  checkWav(audio_wav_b64);
  const { transcript } = await speech(() => transcribe(audio_wav_b64));
  return { body: { transcript, grade: grade(scenario, transcript) } };
});
