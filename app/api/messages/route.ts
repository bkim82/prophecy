import type { ConversationView } from "@/app/lib/messageRules";
import { conversationsFor } from "@/lib/messages";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET → { inbox, requests }: the Messages dock's two lists
 * (app/MessagesDock.tsx), newest conversation first. Friends — and anyone
 * you've accepted or written to — are in the inbox; the rest are requests.
 */
export async function GET() {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const conversations = await conversationsFor(userId);
  const inFolder = (folder: ConversationView["folder"]) => conversations.filter((conversation) => conversation.folder === folder);
  return Response.json({ inbox: inFolder("inbox"), requests: inFolder("request") }, { headers: NO_STORE });
}
