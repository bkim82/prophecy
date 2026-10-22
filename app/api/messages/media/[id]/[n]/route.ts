import { POST_IMAGE_TYPES } from "@/app/lib/postImage";
import { messageImage } from "@/lib/messages";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * GET → one photo of a direct message, for its sender and recipient only
 * (404 for anyone else, the same as a missing photo). Photos never change, so
 * the browser may keep them for an hour — privately.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { id, n } = await ctx.params;
  const position = Number(n);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(position) || position < 0 || position > 3) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const image = await messageImage(userId, id, position);
    if (!image || !POST_IMAGE_TYPES.includes(image.mime)) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Cache-Control": "private, max-age=3600",
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
