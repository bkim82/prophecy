import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { onboarding } from "@/db/schema";
import type { OnboardingAnswers } from "@/app/lib/onboardingQuestions";

// Reads/writes for the `onboarding` table (db/schema.ts). Validation lives in
// app/welcome/actions.ts; this layer only stores what it's handed.

export async function isOnboarded(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ userId: onboarding.userId }).from(onboarding).where(eq(onboarding.userId, userId));
  return Boolean(row);
}

/** Upsert, so finishing twice (double submit, back button) just keeps the latest answers. */
export async function saveOnboarding(userId: string, answers: OnboardingAnswers): Promise<void> {
  const set = { ...answers, completedAt: new Date() };
  await getDb()
    .insert(onboarding)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: onboarding.userId, set });
}
