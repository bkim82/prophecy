import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const db = getDb();
  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (existing) {
    return Response.json({ balance: existing.balance });
  }

  const [created] = await db
    .insert(users)
    .values({ id: userId })
    .onConflictDoNothing()
    .returning();

  const balance = created?.balance ?? 1000;
  return Response.json({ balance });
}
