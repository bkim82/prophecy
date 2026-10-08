import type { Metadata } from "next";
import { TutorialView } from "./TutorialView";

export const metadata: Metadata = {
  title: "Learn Pulse — Prophecy",
  description: "An interactive Pulse tutorial: long, short, leverage, liquidation, when to close, then a live round against a bot. Practice money only.",
};

export default function TutorialPage() {
  return <TutorialView />;
}
