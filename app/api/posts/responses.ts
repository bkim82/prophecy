import { mutationRequestFailure } from "@/lib/requestSecurity";

// Shared by the /api/posts routes: no-store JSON, the same-origin JSON
// mutation check (lib/requestSecurity.ts) and a size-capped JSON body read.

export function postsJson(body: object, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { ...init?.headers, "Cache-Control": "no-store" } });
}

export function postsMutationFailure(request: Request, maxBodyBytes?: number) {
  const failure = mutationRequestFailure(request, { maxBodyBytes });
  if (!failure) return null;
  const status = failure === "invalid-origin" ? 403 : failure === "invalid-content-type" ? 415 : failure === "body-too-large" ? 413 : 400;
  return postsJson({ error: failure }, { status });
}

/** Parses a JSON object body of at most `maxBytes`; null when it isn't one. */
export async function readPostsJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null | "too-large"> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) return "too-large";
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
