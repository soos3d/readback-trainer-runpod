// Smoke test against the deployed speech worker. CLI only, never bundled.
// Usage: npx tsx scripts/smoke.ts [--only ping|bogus]
import runpodSdk from "runpod-sdk"; // RUNPOD: the one allowed import outside lib/runpod.ts (DECISIONS.md)

const TASKS = ["ping", "bogus"] as const;
type Task = (typeof TASKS)[number];

function requireVar(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing; set it in web/.env.local`);
  return value;
}

function selectedTasks(argv: string[]): readonly Task[] {
  const i = argv.indexOf("--only");
  if (i === -1) return TASKS;
  const only = argv[i + 1];
  if (!TASKS.includes(only as Task)) throw new Error(`--only takes one of: ${TASKS.join(", ")}`);
  return [only as Task];
}

// RUNPOD STEP 1 — connect with the API key and the endpoint ID from `rp flash deploy`
function speechEndpoint() {
  const endpoint = runpodSdk(requireVar("RUNPOD_API_KEY")).endpoint(requireVar("SPEECH_ENDPOINT_ID"));
  if (!endpoint) throw new Error("runpod-sdk returned no endpoint"); // RUNPOD: endpoint() is typed Endpoint | null
  return endpoint;
}

// RUNPOD STEP 2 — runSync posts /runsync, then polls /status-sync until done or timeout
async function runTask(task: Task): Promise<void> {
  const started = Date.now();
  // RUNPOD: typed EndpointCompletedOutput, but FAILED adds `error` and a timeout returns no output
  const res = (await speechEndpoint().runSync({ input: { task } }, 80_000)) as {
    status: string;
    output?: unknown;
    error?: string;
  };
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const detail = res.status === "COMPLETED" ? JSON.stringify(res.output) : `error: ${res.error ?? "none"}`;
  process.stdout.write(`${task}: status: ${res.status} in ${seconds}s ${detail}\n`);
}

process.loadEnvFile(".env.local");
for (const task of selectedTasks(process.argv.slice(2))) await runTask(task);
