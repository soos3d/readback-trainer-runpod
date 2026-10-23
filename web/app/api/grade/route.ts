import { grade } from "@/lib/grader";
import { readJson, route } from "@/lib/route";
import { GradeRequest } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("/api/grade", async (req) => {
  const { scenario, transcript } = GradeRequest.parse(await readJson(req));
  return { body: grade(scenario, transcript) };
});
