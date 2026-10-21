import { Composer } from "@/app/compose/Composer";
import { recentCustomTopicsBy } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

// Full-page composer, opened from the feed's "Create Omen" button (desktop
// rail), its floating compose button (≤960px) and the inline composer's
// "+ Trade". `?attach=trade` opens the trade picker straight away; `?text=`
// carries over what you'd typed inline.
export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const text = typeof params.text === "string" ? params.text : "";
  const viewer = await getViewer();
  const ownTopics = viewer ? await recentCustomTopicsBy(viewer.userId).catch(() => []) : [];
  return (
    <main className="compose-shell">
      <Composer initialText={text} openTrades={params.attach === "trade"} ownTopics={ownTopics} />
    </main>
  );
}
