import { profileImageResponse } from "@/app/lib/profileImage";
import { avatarImageFor, handleOwner } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Returns an application-owned profile avatar: the caller's own, or with
 * `?handle=` (stored form) anyone's, for public profiles.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const handle = params.get("handle");
  const scope = handle ? "public" : "private";

  try {
    const userId = handle ? await handleOwner(handle.toLowerCase()) : (await getViewer())?.userId;
    if (!userId && !handle) return Response.json({ error: "Not signed in" }, { status: 401 });
    const avatar = userId ? await avatarImageFor(userId) : null;
    if (!avatar) {
      return Response.json(
        { error: "No avatar" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return profileImageResponse(
      avatar,
      params.has("v") ? `${scope}, max-age=31536000, immutable` : `${scope}, no-cache`,
    );
  } catch {
    return Response.json(
      { error: "Avatar unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
