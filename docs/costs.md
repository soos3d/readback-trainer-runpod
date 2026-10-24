# Costs

What each piece of Readback Trainer bills, how to keep it small, and how to stop it. Prices are list prices read on 2026-10-23; check the Runpod console before you budget, because Runpod's own pages sometimes disagree.

## What bills, and when

| Piece | Runs on | Bills when | List price | Our config |
|---|---|---|---|---|
| Speech worker (`speech/main.py`) | Runpod Serverless, 24 GB Ada (RTX 4090) | A worker is starting, running a job, or waiting out `idle_timeout` | $1.10/hr (≈ $0.00031/s) | `workers=(0, 1)`, `idle_timeout=300`, FlashBoot on |
| Parked standby worker | Runpod Serverless | Never. A parked worker is billed only once it starts running | $0 | Kept by Runpod for every endpoint; FlashBoot restores from it |
| Worker model weights (`runpod.Model`) and image pulls | Runpod host | Not billed while the worker is scaled down | $0 | Whisper staged by `runpod.Model`; Kokoro downloads inside the first job |
| Next.js API backend | Runpod CPU Pod (`cpu3c`) | Every hour the Pod runs, busy or idle | $0.04 per vCPU-hour (2 vCPU ≈ $0.08/hr ≈ $1.92/day) | Smallest size that builds Next.js |
| Pod container disk | Runpod | While the Pod exists, stopped or running | $0.10 per GB-month | A few GB; cents per day |
| Pod volume disk | Runpod | Running $0.10, stopped $0.20 per GB-month | — | Not used |
| AviationWeather.gov, OpenSky | External | — | $0 (rate-limited, see README) | Cached in the Pod process |

Runpod applies a default account spend limit of $80/hour across all resources.

## What one practice session costs

A session is: page load (warm-up ping), a few calls, a few readbacks, then the user leaves.

| Phase | GPU time billed | Cost |
|---|---|---|
| Cold start (first job after scale-to-zero) | ≈ 10 s of execution (models load) plus worker boot | ≈ $0.01 |
| Each warm job (tts 1.3 s, transcribe 2.1 s, ping 0.4 s) | Seconds | < $0.001 each |
| Idle tail after the last job (`idle_timeout=300`) | 300 s | ≈ $0.09 |
| **Session total** | | **≈ $0.10** |

The idle tail dominates. Lowering `idle_timeout` to 60 s cuts it to ≈ $0.02 per session, at the price of more 30 s cold starts when a user pauses for more than a minute.

Measured (T12): cold ping 29–33 s end to end (about 22 s waiting for a worker, 10 s loading both models), then cold tts 3.3 s and transcribe 2.3 s. Warm: ping 0.4–1.1 s, tts 1.4 s, transcribe 1.9 s.

## Keeping the GPU ready without paying for it all day

| Option | How | Cost | Trade-off |
|---|---|---|---|
| Flex + FlashBoot standby (current) | `workers=(0, 1)`, `flashboot=True` | Only while working, plus the idle tail | First call after a quiet period cold-starts (≈ 30 s). The UI hides most of it: page load fires a warm-up ping, and the call text never waits for audio |
| Longer warm window | Raise `idle_timeout` (Flash allows 1–3600 s) | $1.10/hr of extra warm time per session | Fewer cold starts during long sessions |
| Always-on worker | `workers=(1, 1)` | $1.10/hr, 24/7 ≈ $26/day | No cold starts ever. Too expensive for a sample |
| Warm only during a demo | Redeploy with `workers=(1, 1)` before the demo, back to `(0, 1)` after | ≈ $1.10 per demo hour | No cold start in front of an audience; needs two deploys |

FlashBoot snapshots are tied to a host and image, so a scale-up that lands on a different host pays the full boot.

## Spend so far

| Step | GPU / Pod time | Cost |
|---|---|---|
| T02 spike (ping worker) | ≈ 13 worker-minutes | ≈ $0.25 (estimate from the list rate) |
| T12 deploy and smoke | ≈ 24 worker-minutes | ≈ $0.45 (estimate) |
| T17 Pod deploy (`cpu3c`, $0.06/hr) | Pod running since 2026-10-23 | ≈ $0.02 at hand-off; bills until stopped |
| **Total so far** | | **≈ $0.72 of the $10 cap, plus Pod hours** |

## How to stop billing

1. Stop the Pod after a demo: compute stops billing; the container disk keeps billing until you terminate.
2. Terminate the Pod when done.
3. The speech endpoint at `workers=(0, 1)` costs nothing while idle. Remove it with `rp flash undeploy --app readback-speech --env default`.
4. Revoke the Restricted API key.

## Sources

- [Runpod Serverless pricing](https://docs.runpod.io/serverless/pricing)
- [Runpod pricing page](https://www.runpod.io/pricing)
- [Endpoint settings](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)
- [Flash endpoint parameters](https://docs.runpod.io/flash/configuration/parameters)
- [CPU types API](https://docs.runpod.io/api-reference-v2/catalog/list-cpu-types)
- [Serverless billing when jobs fail](https://www.runpod.io/blog/failed-requests-real-charges-how-runpod-serverless-billing-works-when-workers-fail)
