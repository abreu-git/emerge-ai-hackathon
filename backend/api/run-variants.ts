import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors, methodGuard } from "./_lib/cors.js";
import { getOpenAI, OPENAI_MODEL } from "./_lib/openai.js";

export type VariantType = "PARAPHRASE" | "ROLE_SHIFT" | "SPECIFICITY_SHIFT";

export interface VariantInput {
  type: VariantType;
  prompt: string;
  expected_inconsistency?: string;
}

export interface RunResponse {
  prompt: string;
  response: string;
  type?: VariantType | "ORIGINAL";
  expected_inconsistency?: string;
  tokens?: { input: number; output: number };
  error?: string;
}

export interface RunVariantsResult {
  original: RunResponse;
  variants: RunResponse[];
  elapsed_ms: number;
}

async function runOne(prompt: string): Promise<{ response: string; tokens: { input: number; output: number } }> {
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const choice = completion.choices[0];
  const text = choice?.message?.content ?? "";
  return {
    response: text,
    tokens: {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Run the original prompt + N variants against gpt-4o in parallel.
 * All calls execute concurrently via Promise.all. Partial failures are
 * reported per-response with an `error` field rather than failing the batch.
 */
export async function runVariants(
  originalPrompt: string,
  variants: VariantInput[]
): Promise<RunVariantsResult> {
  const started = Date.now();

  const settled = await Promise.all([
    runOne(originalPrompt).then(
      (r) => ({ kind: "original" as const, ok: true as const, ...r }),
      (e) => ({ kind: "original" as const, ok: false as const, error: e instanceof Error ? e.message : String(e) })
    ),
    ...variants.map((v) =>
      runOne(v.prompt).then(
        (r) => ({ kind: "variant" as const, ok: true as const, variant: v, ...r }),
        (e) => ({
          kind: "variant" as const,
          ok: false as const,
          variant: v,
          error: e instanceof Error ? e.message : String(e),
        })
      )
    ),
  ]);

  const elapsed_ms = Date.now() - started;

  const originalResult = settled[0] as Extract<(typeof settled)[number], { kind: "original" }>;
  const variantResults = settled.slice(1) as Extract<(typeof settled)[number], { kind: "variant" }>[];

  const original: RunResponse = {
    prompt: originalPrompt,
    type: "ORIGINAL",
    response: originalResult.ok ? originalResult.response : "",
    tokens: originalResult.ok ? originalResult.tokens : undefined,
    error: originalResult.ok ? undefined : originalResult.error,
  };

  const variantsOut: RunResponse[] = variantResults.map((vr) => ({
    type: vr.variant.type,
    prompt: vr.variant.prompt,
    expected_inconsistency: vr.variant.expected_inconsistency,
    response: vr.ok ? vr.response : "",
    tokens: vr.ok ? vr.tokens : undefined,
    error: vr.ok ? undefined : vr.error,
  }));

  return { original, variants: variantsOut, elapsed_ms };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (applyCors(req, res)) return;
  if (methodGuard(req, res, ["POST"])) return;

  const body = (req.body ?? {}) as {
    prompt?: unknown;
    variants?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const variants = Array.isArray(body.variants) ? (body.variants as VariantInput[]) : null;

  if (!prompt) {
    res.status(400).json({ error: "body.prompt (string) is required" });
    return;
  }
  if (!variants || variants.length === 0) {
    res.status(400).json({ error: "body.variants (array) is required" });
    return;
  }
  for (const v of variants) {
    if (typeof v?.prompt !== "string" || typeof v?.type !== "string") {
      res.status(400).json({ error: "each variant requires {type, prompt}" });
      return;
    }
  }
  if (variants.length > 5) {
    res.status(400).json({ error: "max 5 variants per request" });
    return;
  }

  try {
    const result = await runVariants(prompt, variants);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[run-variants] error:", message);
    res.status(500).json({ error: "runner failed", detail: message });
  }
}
