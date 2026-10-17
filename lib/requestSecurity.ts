const MAX_MUTATION_BODY_BYTES = 2_048;

export type MutationRequestFailure =
  | "invalid-origin"
  | "invalid-content-type"
  | "body-too-large"
  | "invalid-json"
  | "unexpected-body";

function oneForwardedValue(value: string | null) {
  if (!value || value.includes(",")) return null;
  return value.trim().toLowerCase();
}

export function mutationRequestFailure(request: Request): MutationRequestFailure | null {
  const originHeader = request.headers.get("origin");
  const host = oneForwardedValue(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  const protocol = oneForwardedValue(request.headers.get("x-forwarded-proto"))
    ?? new URL(request.url).protocol.slice(0, -1).toLowerCase();

  if (!originHeader || !host || (protocol !== "http" && protocol !== "https")) {
    return "invalid-origin";
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return "invalid-origin";
  }

  if (origin.pathname !== "/" || origin.search || origin.hash) return "invalid-origin";
  if (origin.host.toLowerCase() !== host || origin.protocol !== `${protocol}:`) {
    return "invalid-origin";
  }

  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin) {
    try {
      if (origin.origin !== new URL(configuredOrigin).origin) return "invalid-origin";
    } catch {
      return "invalid-origin";
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return "invalid-origin";
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return "invalid-content-type";

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_MUTATION_BODY_BYTES)) {
    return "body-too-large";
  }

  return null;
}

export async function emptyJsonBodyFailure(
  request: Request,
): Promise<Exclude<MutationRequestFailure, "invalid-origin" | "invalid-content-type"> | null> {
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_MUTATION_BODY_BYTES) return "body-too-large";

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "invalid-json";
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed as Record<string, unknown>).length !== 0
  ) {
    return "unexpected-body";
  }
  return null;
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]{1,8192})$/);
  return match?.[1] ?? null;
}

export function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
