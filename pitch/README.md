# pitch/

Marketing + agent-testing evidence for FlowLink.

| File | What |
|---|---|
| `live-duel.html` | **NEW** — investor-grade side-by-side replay of two real Claude agents racing through the same task. Reads `/agent-logs/live/*.json` and animates each agent's *reasoning* (italic thought bubbles) + their tool calls. Press Replay. |
| `live-duel.png` | Full-page screenshot of the duel in its final state — A SETTLED, B BLOCKED. |
| `agent-logs/live/{enabled-A,baseline-B}.json` | The transcripts the duel page replays — captured during a real session. |
| `v0.2-preview.html` | 5-slide UX preview of v0.2 features (SSE, MCP, OpenAPI, dashboard, observability) — built before the code was written. |
| `v0.2-preview.png` | Full-page screenshot of the preview. |
| `index.html` | Original "Markdown is the API" 16:9 pitch slide. Animated agent-terminal. |
| `comparison.html` | Earlier side-by-side comparison. Lighter than `live-duel.html` — kept for reference. |
| `comparison.png` | Screenshot of the earlier comparison. |
| `agent-native-slide.png` | Rendered agent-native pitch slide. |
| `flowlink-pitch-deck.pdf` | Full pitch deck. |
| `landing.png` | Live screenshot of the agent-native landing page. |
| `demo-live-run.log` | End-to-end demo agent transcript (SIWE → invoice → pay → receipt) from `scripts/demo-agent.mjs`. |
| `agent-logs/round{1..5}/*.json` | 22 real Claude agent transcripts from earlier rounds — tool calls, observations, the 4 bug-finds that became commits. |
| `agent-logs/v0.2/*.md` | One implementation summary per v0.2 feature agent. |

## Viewing the slides

```bash
cd pitch && python3 -m http.server 8080
# open http://localhost:8080/comparison.html
# click "Replay real agent run"
```

## The headline

| Metric | Agent + `.md` skills | Agent + Playwright only |
|---|---|---|
| Avg tool calls | 6 – 10 | 15 – 30 |
| Avg context tokens | 39 – 51K | 51 – 58K |
| Avg duration | 31 – 147 s | 106 – 188 s |
| Task completion | **7 / 7** | **1 / 4** (cheated to read `.md` anyway) |

## Bugs real agents caught

Reading the agent-logs in order tells a little story:

- **round1 enabled-3** noticed a Problem+JSON contract violation on compliance 403 — fixed in [`811b45c`](https://github.com/Akasxh/flowlink/commit/811b45c).
- **round2 idempotency-probe** caught `sanctions_source` leaking cache state — same commit.
- **round3 siwe-probe** and **round3 concurrency** independently caught a P0: SIWE nonce endpoint returned HTTP 500 on every call because `DEFAULT_STATEMENT` had a Unicode em-dash the EIP-4361 ABNF parser rejects. Same commit.
- **round4 siwe-fix-verified** confirmed the fix with 18/18 assertions.
- **round5 final-validation** and **round5 docs-2nd-pass** both reported `ready` / `consistent` — no drift remains.

Without real-agent testing none of these would have shipped.
