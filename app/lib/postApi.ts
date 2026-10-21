// Client side of POST /api/posts, shared by both composers
// (app/compose/Composer.tsx, app/FeedComposer.tsx). Sends only what the
// author chose — the server derives the author and resolves the trade.

export type PostPayload = {
  content: string;
  topics?: string[];
  tradeId?: string | null;
  gif?: string | null;
  poll?: { choices: string[]; duration: string } | null;
  photos?: { mime: string; data: string }[];
};

export type PublishResult = { ok: true; id: string } | { ok: false; status: number; error: string };

export async function publishPost(payload: PostPayload): Promise<PublishResult> {
  try {
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (response.ok && body.id) return { ok: true, id: body.id };
    return { ok: false, status: response.status, error: body.error ?? "Couldn't post. Try again." };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach Prophecy. Check your connection and try again." };
  }
}
