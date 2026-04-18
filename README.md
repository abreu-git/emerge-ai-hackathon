# Echo

**See the same AI, from every angle.**

Personal red teaming for LLMs. Ask ChatGPT anything, and Echo silently generates 3 adversarial variants (paraphrase, role shift, specificity shift), runs them against the same underlying model (gpt-4o), and scores consistency in real time. Built at the eMerge AI Hackathon 2026 — Enterprise AI / AI Safety, Trust & Governance track.

## How it works

1. You write a prompt in ChatGPT.
2. Echo detects the prompt and generates 3 adversarial variants with Claude.
3. Echo runs the 3 variants in parallel against gpt-4o (the same model that powers ChatGPT).
4. Claude analyzes the 4 responses — stance, factual claims, recommendation, confidence — and returns a consistency score (0–100).
5. The sidebar shows all 4 responses side-by-side with contradictions highlighted.

## Repo layout

```
extension/   Chrome extension (Manifest V3)
backend/     Vercel serverless API (variants, runner, analyzer, orchestrator)
```

## Loading the extension locally

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Visit https://chatgpt.com — you'll see the Echo button bottom-right.

## Status

Work in progress. Built live at eMerge AI Hackathon, April 18 2026.
