import { SUPPORTED_PRODUCTS, getSpotPrice } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("symbol") ?? "BTC-USD";
  if (!SUPPORTED_PRODUCTS.has(product)) {
    return Response.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  const spot = await getSpotPrice(product);
  if (spot) {
    return Response.json(spot, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({ error: `Could not fetch ${product} price` }, { status: 502 });
}
