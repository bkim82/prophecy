import { SanctumView } from "@/app/sanctum/SanctumView";

// `?rank=gold` previews another tier's entry gate until real per-user rank
// exists (app/lib/rank.ts is a stub); the room itself stays Oracle.
export default async function SanctumPage({ searchParams }: { searchParams: Promise<{ rank?: string | string[] }> }) {
  const { rank } = await searchParams;
  return <SanctumView previewRank={typeof rank === "string" ? rank : undefined} />;
}
