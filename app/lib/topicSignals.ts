"use client";

import { useCallback } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import type { ClientTopicSignal } from "@/app/lib/topicInterest";
import type { TopicId } from "@/app/lib/topics";

// Reports engagement for inferred interests (POST /api/topics/signal) —
// fire-and-forget, signed in only. Composer posts that haven't been saved
// (`local-` ids) have nothing to credit.
export function useTopicSignal() {
  const { isSignedIn } = useAppAuth();
  return useCallback(
    (signal: ClientTopicSignal, target: { postId: string } | { topic: TopicId }, on = true) => {
      if (!isSignedIn || ("postId" in target && target.postId.startsWith("local-"))) return;
      void fetch("/api/topics/signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal, ...target, on }),
        keepalive: true,
      }).catch(() => {});
    },
    [isSignedIn],
  );
}
