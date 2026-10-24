# AGENTS.md

Context for coding agents that deploy or change Readback Trainer. Humans: start with [README.md](README.md).

## What this is

A trainer for GA pilots to practice ATC readbacks, and a Runpod sample. Two deployable parts:

| Part | Path | Runs on | Deploy with |
|---|---|---|---|
| Next.js app (UI + API routes) | `web/` | Runpod CPU Pod, `next start` on port 3000 | Pod start command clones the repo and builds |
| Speech worker (Kokoro TTS + Whisper ATC) | `speech/main.py` | Runpod Serverless GPU, queue endpoint `speech` | `rp flash deploy` from `speech/` |

The browser calls only `/api/*` on the Pod. The Pod holds every key and calls AviationWeather.gov, OpenSky and the speech endpoint. Request flows, fallbacks, timeouts and error codes are in [docs/architecture.md](docs/architecture.md). Prices are in [docs/costs.md](docs/costs.md). Runpod behavior that differs from the docs is in [docs/friction-log.md](docs/friction-log.md); read it before you deploy.

## Ask the user before you

- Spend money: deploying the worker, creating or restarting a Pod.
- Create, rotate or delete any API key, secret or deploy key.
- Change `workers`, `idle_timeout` or `gpu` in `speech/main.py`.
- Terminate a Pod or undeploy the worker.
- Edit `web/lib/airports.json` (see "Aviation data" below).

## Secrets

- Never print, log, commit or echo a key. Never `source web/.env.local`: `AWC_USER_AGENT` contains spaces. Read one value with `grep '^NAME=' web/.env.local | cut -d= -f2-` and pass it on without printing it.
- Two Runpod keys. The account key deploys the worker and creates the Pod; it stays on the user's machine. A Restricted key scoped to the speech endpoint goes in the app's `RUNPOD_API_KEY`, locally and on the Pod. The user creates the Restricted key in the console.
- App code reads env vars only through `requireEnv()` in `web/lib/env.ts`, in files that start with `import "server-only"`. Never prefix a secret with `NEXT_PUBLIC_`.
- The app's variables are listed in `web/.env.example`.

## Deploy runbook

The user does steps 1 and 2. You run the rest and stop at each spend for approval.

1. Accounts: Runpod with credit, and an OpenSky API client (client ID and secret).
2. `web/.env.local` filled from `web/.env.example`, and the account key exported as `RUNPOD_API_KEY` in your shell.
3. Run locally and check it works: `cd web && npm ci && npm test && npm run dev`. A takeoff call at http://localhost:3000 should build, without audio.
4. Deploy the worker:
   ```
   cd speech && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
   .venv/bin/rp flash deploy
   ```
   The last line prints `speech  <endpoint id>`. The user puts it in `web/.env.local` as `SPEECH_ENDPOINT_ID`, then creates the Restricted key for that endpoint and puts it in `RUNPOD_API_KEY` there.
5. Smoke-test the worker from `web/`: `npx tsx --env-file=.env.local scripts/smoke.ts`. The first run waits for a GPU cold start.
6. Create the Runpod secrets `readback_runpod_key`, `readback_endpoint_id`, `readback_opensky_id`, `readback_opensky_secret` and `readback_awc_user_agent`. The REST API and the Runpod MCP server have no secrets endpoint. Use the console, or the GraphQL mutation `secretCreate(input: {name, value})` with the account key.
7. Create the Pod. Use the console steps in the README, the REST API (`POST https://rest.runpod.io/v1/pods`, [reference](https://docs.runpod.io/api-reference)) or the Runpod MCP server. Settings:
   - CPU, flavor `cpu3c`, 2 vCPU, 10 GB container disk, no volume
   - image `node:22-bookworm-slim`, port `3000/http`
   - env: each app variable mapped as `NAME={{ RUNPOD_SECRET_<secret> }}`, as in README step 4
   - start command (`dockerStartCmd`): the `bash -c "…"` line in README step 4, with the user's repo URL
8. Verify against `https://<POD_ID>-3000.proxy.runpod.net`:
   ```
   curl -sf $URL/api/airports
   curl -sf -X POST $URL/api/scenario -H 'content-type: application/json' -d '{"airport":"KTTD","type":"takeoff"}'
   ```
   The scenario's `provenance.weather.source` should be `live` and `flight.source` should be `opensky`.
9. Tell the user the Pod bills every hour it runs, and how to stop it (README, "What it costs").

Redeploy the app: push to `main`, then restart the Pod. Every start clones and builds again.

## Runpod gotchas

- After `rp flash deploy`, workers can serve the old code for 7–20 minutes. Send `ping` jobs until the output has `models_loaded: true` before you trust a result.
- `rp` reads `RUNPOD_API_KEY` from the environment; no `rp login` is needed.
- `/health` reports parked workers as `idle`. Only `running` is a billed worker.
- The worker image ships torch. Never add torch to `speech/requirements.txt`. `main.py` sets `PIP_NO_DEPS=1`, so `requirements.txt` pins the full dependency closure; regenerate it whenever a direct pin changes (friction log, T10).
- The Pod proxy closes requests at 100 s, so `web/lib/runpod.ts` gives up at 80 s and returns 503 `speech_warming`. Don't raise that limit.

## Working on the code

- Commands, from `web/`: `npm test` (offline, about a second), `npx tsc --noEmit`, `npm run build`. From `speech/`: `.venv/bin/pytest -q`.
- Run all three web commands before you call a change done.
- Write a failing test first. Tests never touch the network or a GPU: stub `fetch` with `vi.stubGlobal`, mock `lib/runpod.ts` with `vi.mock`, use `web/tests/fixtures/`.
- Only `web/lib/runpod.ts` and `web/scripts/smoke.ts` import `runpod-sdk`. Tag Runpod-specific lines with `// RUNPOD:` or `# RUNPOD:` and keep the numbered `RUNPOD STEP` blocks in order.
- Validate every external input with zod at the boundary (`web/lib/schemas.ts`). Upstream failures become a labeled fallback plus a `warnings` entry; other errors throw an `ApiError` mapped by `toResponse()`.
- No `console.log` in app code. Server logs go through `log()` in `web/lib/errors.ts`.
- Use `mulberry32` from `web/lib/prng.ts`, never `Math.random()`, under `web/lib/`. The same seed must give the same scenario.
- TypeScript `strict`, ESM, Next.js App Router. UI uses CSS modules and the tokens in `web/app/globals.css`; no UI kit, no emoji.

## Aviation data

`web/lib/airports.json` holds frequencies, runways and approaches from public FAA data. Never invent a value: a field without a source is `"TODO"`, and the call types that need it return 422. When you add an airport, cite the source to the user and let them check it. Some tests read the shipped file (`tests/core.test.ts`, `tests/scenarios.test.ts`), so update their expectations along with the data.
