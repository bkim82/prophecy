import { profileImageResponse } from "@/app/lib/profileImage";
import { avatarImageFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Returns the caller's application-owned profile avatar. */
export async function GET(request: Request) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const avatar = await avatarImageFor(userId);
    if (!avatar) {
      return Response.json(
        { error: "No avatar" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const versioned = new URL(request.url).searchParams.has("v");
    return profileImageResponse(
      avatar,
      versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
    );
  } catch {
    return Response.json(
      { error: "Avatar unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
