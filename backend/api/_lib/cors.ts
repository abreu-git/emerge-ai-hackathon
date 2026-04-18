import type { VercelRequest, VercelResponse } from "@vercel/node";

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function methodGuard(
  req: VercelRequest,
  res: VercelResponse,
  allowed: string[]
): boolean {
  if (!req.method || !allowed.includes(req.method)) {
    res.status(405).json({ error: `method ${req.method} not allowed` });
    return true;
  }
  return false;
}
