import { auth } from "@clerk/nextjs/server";
import { bannerImageFor } from "@/lib/profile";

export const dynamic = "force-dynamic";

/**
 * GET → the caller's own uploaded profile banner (owner-only: real profiles
 * aren't public yet). /profile links it as `?v=<updatedAt>`, so a new upload
 * is a new URL and the response can be cached for good.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const banner = await bannerImageFor(userId);
    if (!banner) return Response.json({ error: "No banner" }, { status: 404 });
    return new Response(new Uint8Array(banner.bytes), {
      headers: { "Content-Type": banner.mime, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch {
    return Response.json({ error: "Banner unavailable" }, { status: 503 });
  }
}
