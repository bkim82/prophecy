import { POST_IMAGE_TYPES } from "@/app/lib/postImage";
import { postImage } from "@/lib/posts";

export const dynamic = "force-dynamic";

/**
 * GET → one photo of a saved post, public like the post itself. A post's
 * photos never change, but a delete should take them down, so caching is an
 * hour rather than immutable.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const position = Number(n);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(position) || position < 0 || position > 3) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const image = await postImage(id, position);
    if (!image || !POST_IMAGE_TYPES.includes(image.mime)) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": "inline",
        "Content-Length": String(image.bytes.byteLength),
        "Content-Type": image.mime,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Image unavailable" }, { status: 503 });
  }
}
