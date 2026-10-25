# Runpod friction log

What slowed me down building Readback Trainer on Runpod (Flash `runpod` 2.0.0rc1, `runpod-sdk` 1.1.2). I built it with a coding agent, so there are two lists.

## As a developer

- **"Live" didn't mean live.** After a redeploy, workers kept running the old code for 7 to 20 minutes. Now I ping after every deploy until the new code answers.
- **A second torch got bundled.** Libraries that depend on torch pulled it back into the deploy, over the image's CUDA build. Fixed with `PIP_NO_DEPS=1` and pinned dependencies.
- **A hidden 100 s timeout.** The Pod URL cuts requests at 100 s, and `runSync` can wait about twice its timeout. I added my own 80 s limit.
- **`/health` looked like I was paying.** `idle: 1` after scale-down isn't billed; only `running` is.
- **SDK types don't match responses.** Failed and timed-out jobs return fields the types don't have, so I validate every response.
- **Errors include the full traceback.** I keep only the message so file paths don't reach the browser.

## As a coding agent

- **No API for secrets.** REST and the MCP server don't cover them; the agent used an undocumented GraphQL mutation.
- **No reliable "deploy finished" signal.** The status said ready before workers ran the new build.
- **Deploy output is plain text.** The endpoint ID has to be scraped from the last line; a `--json` flag would help.

## What just worked

- A GPU worker deployed on the first try with no Dockerfile.
- The CLI reads the API key from the environment, so there's no browser login.
- Cold start was about 30 s, with the Whisper weights staged ahead of time.
- The CPU Pod was serving the app about 37 s after it was created.
