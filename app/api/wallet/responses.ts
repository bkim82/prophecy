import { consumeRateLimit, rateLimitKey } from "@/lib/appSession";
import { mutationRequestFailure, requestIp } from "@/lib/requestSecurity";
import type { Viewer } from "@/lib/viewer";

const MAX_BODY_BYTES = 8_192;

export function walletJson(body: object, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...init?.headers, "Cache-Control": "no-store" },
  });
}

export function walletMutationHeaderFailure(request: Request) {
  const failure = mutationRequestFailure(request);
  if (!failure) return null;
  const status = failure === "invalid-origin" ? 403
    : failure === "invalid-content-type" ? 415
      : failure === "body-too-large" ? 413
        : 400;
  return walletJson({ error: failure }, { status });
}

export async function readWalletJson(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new WalletRequestError("body-too-large", 413);
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new WalletRequestError("invalid-json-object", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WalletRequestError) throw error;
    throw new WalletRequestError("invalid-json", 400);
  }
}

export class WalletRequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WalletRequestError";
  }
}

export async function walletRateLimit(
  request: Request,
  viewer: Viewer,
  scope: string,
  limit: number,
  windowMs = 60_000,
) {
  const [ipAllowed, userAllowed] = await Promise.all([
    consumeRateLimit(rateLimitKey(`${scope}:ip`, requestIp(request)), limit * 2, windowMs),
    consumeRateLimit(rateLimitKey(`${scope}:user`, viewer.userId), limit, windowMs),
  ]);
  return ipAllowed && userAllowed;
}
