# Echo

**Your AI is nicer than it should be.**

Echo is a real-time sycophancy detector for any LLM an enterprise deploys. It sits next to ChatGPT, Claude, and Gemini, rewrites every user prompt into three adversarial framings (supportive / opposing / neutral), runs them in parallel against the same model, and scores how much the answer drifts on a 0–100 consistency scale.

When a model quietly shifts position based on how the user phrases the question, Echo produces a labeled audit trail: stance drift, hedging asymmetry, factual contradictions, and a per-answer trust recommendation. No workflow change for the end-user. No retraining.

Built for the **Enterprise AI Safety, Trust & Governance** track at eMerge AI Hackathon 2026 — the category scoped as *"guardrails, evals, observability, and compliance tooling for enterprises deploying AI at scale."* Echo is the observability layer: continuous consistency evals on every production LLM answer, not just pre-deployment.

---

## Quickstart for judges (~2 minutes, no API keys)

Echo's backend is already deployed on Railway. You only need to load the extension.

1. Clone this repo (or download the `extension/` folder).
2. Open `chrome://extensions` → enable **Developer mode** (top-right).
3. Click **Load unpacked** → pick the `echo/extension/` folder.
4. Open any of:
   - `https://chatgpt.com/`
   - `https://claude.ai/`
   - `https://gemini.google.com/`
5. Click the **Echo icon** inside the composer (next to the `+` / mic button). The side panel opens on the right.
6. Ask an opinion-sensitive question — e.g. *"I'm thinking of quitting my job to day-trade, is this smart?"*
7. Watch the 3 adversarial variants stream in parallel, then the consistency score resolve.

Try the same question in different framings ("I'm excited about X" vs "I'm worried about X") to see sycophancy surface live.

### Troubleshooting

| Symptom | Fix |
|---|---|
| No Echo icon appears in composer | Reload the page — content scripts only inject on fresh loads. |
| Side panel doesn't open | Click Echo icon a second time — Chrome sometimes needs two clicks on first use. |
| `partial failure — not enough responses` | One variant upstream hit a rate limit. Re-ask the question. |

---

## The problem

Every LLM wants to be liked. The model infers your stance from how you phrase the question and mirrors it back — a risk-averse analyst gets risk-averse answers, an enthusiastic founder gets validation. Same underlying question, materially different recommendation depending on who's asking.

This is invisible in normal usage. You only notice it if you happen to ask the same thing twice, framed differently, and compare answers side-by-side. Nobody does that.

Echo does that automatically, for every answer, in real time.

---

## How it works

```
       ┌─────────────────────────────────────────────┐
       │  1. User sends prompt in ChatGPT / Claude / │
       │     Gemini — Echo captures it from the DOM  │
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  2. Claude generates 3 adversarial variants │
       │     ─ SUPPORTIVE framing (positive lean)    │
       │     ─ OPPOSING   framing (skeptical lean)   │
       │     ─ NEUTRAL    framing (clean control)    │
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  3. All 3 variants run in parallel against  │
       │     the SAME model the user is talking to   │
       │     (GPT-5 / Claude Opus 4.7 / Gemini 2.5)  │
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  4. Claude analyzes all 4 responses:        │
       │     stance · emphasis · hedging · facts ·   │
       │     recommendation — returns a 0–100 score  │
       │     and labeled contradictions.             │
       └──────────────────────┬──────────────────────┘
                              ▼
       ┌─────────────────────────────────────────────┐
       │  5. Side panel shows all 4 responses as a   │
       │     carousel + consistency score + drawer   │
       │     with per-dimension contradictions.      │
       └─────────────────────────────────────────────┘
```

The variants are **framing attacks**: same underlying topic, opposing emotional cues. A principled model gives substantively the same answer regardless of framing. A sycophantic model drifts — and Echo surfaces the drift immediately.

---

## Supported surfaces

| Host | Model routed to variants | Status |
|---|---|---|
| `chatgpt.com`, `chat.openai.com` | `gpt-5` (OpenAI) | Live |
| `claude.ai`, `claude.com` | `claude-opus-4-7` (Anthropic) | Live |
| `gemini.google.com` | `gemini-2.5-flash` (Google) | Live |

The variant-generation model and the analyzer are always Claude Sonnet 4.6, regardless of which site the user is on — keeping the adversarial design stable across surfaces.

---

## Enterprise fit — guardrails, evals, observability, compliance

Echo maps directly onto the four capabilities the track calls out:

- **Guardrail:** the per-answer trust recommendation (`trust` / `verify` / `do_not_trust`) is a real-time gate a client app can surface before a user acts on an LLM answer — the same way a PII filter gates on output.
- **Evals:** the adversarial variant pipeline is a continuous eval running in production, on live user traffic, against the exact model version a user is talking to. Not a pre-deployment benchmark frozen in time.
- **Observability:** every scored interaction produces a structured audit record — stance per response, contradictions by dimension (factual / stance / recommendation / hedging), token counts, model version. This is the missing layer between "chat transcript logged" and "was this answer trustworthy?"
- **Compliance:** for regulated teams (legal, clinical, financial advisory, compliance) that increasingly reach for LLMs, Echo produces the evidence trail an auditor asks for — "can you show me that the answer this analyst acted on wasn't just the model telling them what they wanted to hear?"

Why it matters for enterprise deployments:

- **Sycophancy is invisible in aggregate metrics.** Standard LLM observability (latency, token volume, PII hits, safety filter triggers) doesn't capture whether the model is mirroring the user's stance. Echo is the first signal on that axis.
- **Deployable without vendor cooperation.** A browser-side overlay ships in days. Echo doesn't require the enterprise to swap providers, proxy traffic, or pressure a foundation-model vendor to instrument its own outputs.
- **Same primitive scales to a TSE dashboard.** The consumer browser extension is the demo surface; the same (variant → parallel run → consistency score) pipeline is what a trust-and-safety engineering team would run headlessly across a whole deployment's traffic and surface in an admin console.

---

## Limitations (what Echo does NOT claim)

We want to be honest about the ceiling of this approach — especially for anyone evaluating it against formal red-teaming work:

- **The variant generator is itself an LLM.** If Claude Sonnet has its own biases in how it rewrites "supportive" vs. "opposing" framings, those biases propagate into what Echo can detect. A fully rigorous system would include human-curated adversarial variants.
- **The analyzer is Claude judging GPT / Opus / Gemini.** Cross-model judging is imperfect: Claude may be more forgiving of answers that match its own style. A production deployment should ensemble multiple judge models.
- **3 variants is a small sample.** Sycophancy detection is a statistical claim; 3 reframings per prompt is a quick signal, not a formal eval. The same primitive running 50+ variants per prompt is what a real audit would look like.
- **Drift ≠ hallucination.** Echo measures whether the model's answer *moves* under reframing. It does not measure whether the underlying facts are true. A model can be consistently wrong.
- **DOM-based capture is brittle.** ChatGPT, Claude, and Gemini change their DOMs frequently; the content-script selectors will need maintenance.

Echo is a working primitive and a credible personal red-teaming layer. It is not a replacement for Haize-grade pre-deployment evaluation — it's the consumer-facing complement to it.

---

## Running it locally (optional — for judges who want to inspect)

```sh
cd backend
npm install
cp ../.env.example .env.local      # fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
node dev-server.mjs                # listens on http://127.0.0.1:3939
```

Then point the extension at localhost by editing `extension/config.js`:

```js
self.ECHO_API_BASE = "http://localhost:3939";
```

Reload the extension at `chrome://extensions` and use as normal.

---

## Repo layout

```
extension/   Chrome extension (Manifest V3) — side panel UI, content script,
             composer-button injection for ChatGPT / Claude / Gemini
backend/     Node server (dev-server.mjs) deployed on Railway:
               /api/variants     → 3 adversarial rewrites (Claude Sonnet 4.6)
               /api/stream-one   → NDJSON stream, routed to OpenAI / Anthropic /
                                   Google based on target
               /api/analyze      → consistency score + contradictions (Claude)
               /api/orchestrate  → end-to-end pipeline (batch mode)
```

---

## Tech

- **Extension:** Manifest V3, side panel API, content scripts, per-host DOM selectors, MutationObserver-based stabilized-response capture.
- **Variant generator:** Claude Sonnet 4.6 with structured outputs (JSON schema) + prompt caching on the system prompt.
- **Analyzer:** Claude Sonnet 4.6 with a strict rubric — stance, emphasis/lead, hedging asymmetry, factual claims, recommendation — and anti-default-70 scoring instructions.
- **Streaming:** NDJSON over `fetch` ReadableStream; per-token updates in the side panel.
- **Deploy:** Backend on Railway; extension loaded unpacked (Chrome Web Store submission in progress).

---

## Built at eMerge AI Hackathon 2026

Miami · April 18, 2026 · Enterprise AI / AI Safety, Trust & Governance track.
Judges: Leonardo Tang (Haize Labs), Brian Brackeen (Lightship Capital), Ed Sim (boldstart Ventures), Ayal Stern (The LAB Miami).

Team: Rosangela Abreu · Paola — *Echo Labs*.
