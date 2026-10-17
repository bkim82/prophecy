export type ApplicationSession = {
  user: {
    userId: string;
    smartAccountAddress: string;
    chainId: number;
  };
};

export class ApplicationSessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApplicationSessionError";
  }
}

export function applicationSessionMatches(
  session: ApplicationSession,
  providerUserId: string,
  smartAccountAddresses: string[],
) {
  return session.user.userId === providerUserId
    && session.user.chainId === 8453
    && smartAccountAddresses.length === 1
    && smartAccountAddresses[0].toLowerCase() === session.user.smartAccountAddress.toLowerCase();
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

/** Exchanges a short-lived CDP token for the HttpOnly Prophecy session. */
export async function createApplicationSession(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<ApplicationSession> {
  const response = await fetcher("/api/session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new ApplicationSessionError(
      await responseError(response, "Could not create application session"),
      response.status,
    );
  }

  const body = (await response.json()) as Partial<ApplicationSession>;
  const user = body.user;
  if (
    !user
    || typeof user.userId !== "string"
    || typeof user.smartAccountAddress !== "string"
    || typeof user.chainId !== "number"
  ) {
    throw new ApplicationSessionError("Invalid application session response", 502);
  }
  return { user };
}

/** Revokes and clears the Prophecy session cookie. */
export async function deleteApplicationSession(fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/session", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new ApplicationSessionError(
      await responseError(response, "Could not end application session"),
      response.status,
    );
  }
}

/** Revokes every Prophecy application session for the signed-in user. */
export async function deleteAllApplicationSessions(fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/session/all", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new ApplicationSessionError(
      await responseError(response, "Could not end all application sessions"),
      response.status,
    );
  }
}
