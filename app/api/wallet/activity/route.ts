import { formatUnits } from "@/app/lib/embeddedWallet/intents";
import { curatedToken } from "@/app/lib/embeddedWallet/tokens";
import { getTokenMetadata, getWalletActivity } from "@/lib/alchemy";
import { listTransactionIntents } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";
import { allowWalletRead, walletReadLimited } from "../readLimit";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** GET ?address=0x... -> recent on-chain activity for that address. Public on-chain data, no auth. */
export async function GET(request: Request) {
  if (!await allowWalletRead(request, "activity", 30)) return walletReadLimited();
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !ADDRESS_RE.test(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }

  const [activity, viewer] = await Promise.all([getWalletActivity(address), getViewer()]);
  if (!viewer?.smartAccountAddress || viewer.smartAccountAddress !== address.toLowerCase()) {
    return Response.json({ activity }, { headers: { "Cache-Control": "no-store" } });
  }
  const intents = await listTransactionIntents(viewer.userId, 50);
  const confirmedHashes = new Set(activity.map((item) => item.hash.toLowerCase()));
  const pending = intents
    // An unconfirmed intent never left the confirmation sheet; it is not a transaction.
    .filter((intent) => intent.status !== "created")
    .filter((intent) => !intent.transactionHash || !confirmedHashes.has(intent.transactionHash));
  const symbolOf = async (address: string) => {
    const meta = curatedToken(address) ?? await getTokenMetadata(address);
    return meta?.symbol && meta.decimals != null ? { symbol: meta.symbol, decimals: meta.decimals } : null;
  };
  const local = await Promise.all(pending.map(async (intent) => {
      const [token, toToken] = await Promise.all([
        symbolOf(intent.tokenIn),
        intent.tokenOut ? symbolOf(intent.tokenOut) : null,
      ]);
      return {
        hash: intent.transactionHash ?? intent.userOperationHash ?? intent.id,
        kind: intent.kind === "swap" ? "swapped" : "sent",
        asset: token?.symbol ?? intent.tokenIn,
        // Display-only; the exact amount stays in rawAmount.
        value: token ? Number(formatUnits(BigInt(intent.inputAmount), token.decimals)) : null,
        toAsset: intent.tokenOut ? toToken?.symbol ?? intent.tokenOut : null,
        toValue: null,
        timestamp: intent.createdAt.getTime(),
        status: intent.status,
        rawAmount: intent.inputAmount,
        // A swap's recipient is the account itself; only sends show "To …".
        recipient: intent.kind === "swap" ? null : intent.recipient,
        transactionHash: intent.transactionHash,
        failureCode: intent.failureCode,
        local: true,
      };
    }));
  const merged = [...local, ...activity].sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
  );
  return Response.json({ activity: merged }, { headers: { "Cache-Control": "no-store" } });
}
