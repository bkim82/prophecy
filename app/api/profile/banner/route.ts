import { bannerImageFor, handleOwner } from "@/lib/profile";
import { profileImageResponse } from "@/app/lib/profileImage";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * GET → an uploaded profile banner: the caller's own, or with `?handle=`
 * (stored form) anyone's, for public profiles. Pages link it as
 * `?v=<updatedAt>`, so a new upload is a new URL and the response can be
 * cached for good.
 */
export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get("handle");
  try {
    const userId = handle ? await handleOwner(handle.toLowerCase()) : (await getViewer())?.userId;
    if (!userId) return handle ? Response.json({ error: "No banner" }, { status: 404 }) : Response.json({ error: "Not signed in" }, { status: 401 });
    const banner = await bannerImageFor(userId);
    if (!banner) return Response.json({ error: "No banner" }, { status: 404 });
    return profileImageResponse(banner, `${handle ? "public" : "private"}, max-age=31536000, immutable`);
  } catch {
    return Response.json({ error: "Banner unavailable" }, { status: 503 });
  }
}
