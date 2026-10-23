# Runpod friction log

## 2026-10-23 · T02 spike (runpod 2.0.0rc1, runpod-sdk 1.1.2)

**Login needs no browser.** `rp` reads `RUNPOD_API_KEY` from the environment (`runpod/apps/utils/network.py`). `rp login --api-key <key>` also exists and skips the browser flow. The spike never ran `rp login`.

**`@app.queue` worked first try.** No fallback was needed. `rp flash deploy` from `speech/` took 68 s and printed the endpoint ID on its last line (`speech  <id> ↗`). The endpoint name is the function name (`speech`), not the app name.

**`requirements.txt` ships to the worker.** `rp flash deploy` vendors every line of `speech/requirements.txt` plus each decorator's `dependencies`. With `runpod` and `pytest` listed, the artifact held 107 packages (59.5 MB). torch and the other large packages are skipped automatically because the builtin GPU image already has them.

**torch is already on the GPU image.** The builtin image `runpod/queue-gpu:py3.12-latest` preinstalls torch, so the ping worker reads the GPU name with `torch.cuda.get_device_name(0)` and lists no dependencies.

**`input` maps to keyword arguments.** The runtime calls `fn(**job["input"])` (`runpod_sdk_runtime/queue/worker.py` line 105, visible in the traceback below).

**curl `runsync` shape (cold worker, 28.9 s):**
```
{"delayTime":28305,"executionTime":131,"id":"sync-9fbf…-u2",
 "output":{"gpu":"NVIDIA GeForce RTX 4090","load_count":1,"models_loaded":false,"ok":true},
 "status":"COMPLETED","workerId":"1wpo89df4y98tb"}
```

**A raised exception gives `status: "FAILED"`, and `error` is a JSON string, not an object:**
```
{"delayTime":18,"error":"{\"error_type\": \"<class 'ValueError'>\", \"error_message\": \"unknown task: bogus\",
 \"error_traceback\": \"Traceback …\", \"hostname\": \"…\", \"worker_id\": \"…\", \"runpod_version\": \"2.0.0rc1\"}",
 "id":"…","status":"FAILED","workerId":"…"}
```
`lib/runpod.ts` should `JSON.parse(error)` and pass on `error_message` only. The traceback includes file paths and must not reach the browser.

**runpod-sdk 1.1.2 types don't match its responses.**
- `runpodSdk(key).endpoint(id)` is typed `Endpoint | null`, so callers need a null check under `strict`.
- `runSync()` is typed `Promise<EndpointCompletedOutput>`. It actually returns the raw body plus `started`, `completed` and `succeeded`; a FAILED job carries `error`, which the type lacks, and a timeout returns no `output`.
- `health()` returns `workers.unhealthy`, which `HealthCheck` lacks.
- `runSync()` calls `console.log("<id>: <status>")` on every poll, so a cold start writes to server logs. Its timeout clock starts after the first `/runsync` returns, so the worst case is about two timeouts.

**Cache survives on a warm worker.** Two pings 1 s apart both returned `load_count: 1` from worker `1wpo89df4y98tb`.

**Timings (ping, measured from the client).** First job after deploy: 28.9 s (`delayTime` 28.3 s). Cold start after the worker scaled to zero: 15.2 s; FlashBoot is on by default. Warm: 0.4 s. After scale-down, `/health` reports `workers: {idle: 1, ready: 1, running: 0}`, so `idle` alone does not mean a billed worker. Use `running` to check for one.
