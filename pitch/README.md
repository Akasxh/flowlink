# pitch/

Marketing + agent-testing evidence for FlowLink.

| File | What |
|---|---|
| `index.html` | Original "Markdown is the API" 16:9 pitch slide. Animated agent-terminal. |
| `comparison.html` | Side-by-side replay: agent WITH vs WITHOUT `/skills/*.md`. Real numbers from 22 agent probes. |
| `comparison.png` | Full-page screenshot of the comparison slides (stacked). |
| `agent-native-slide.png` | Rendered agent-native pitch slide. |
| `flowlink-pitch-deck.pdf` | Full pitch deck. |
| `agent-logs/round{1..5}/*.json` | 22 real Claude agent transcripts — tool calls, bytes, observations. Including the 4 bug-finds that became commits. |

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
