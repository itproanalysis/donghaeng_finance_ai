import { JUDGE_DEMO } from "@/domain/judge-demo";
import type { LiveInterviewView } from "./api-adapter";

/** Transcript persistence precedes domain commit; pending turns are not completed answers. */
export function judgeDemoProgress(live: Pick<LiveInterviewView, "transcript" | "pendingCommand">) {
  const turns = live.transcript.filter((segment) => segment.speaker === "BORROWER");
  const pending = live.pendingCommand;
  const lastTurn = turns.at(-1);
  const pendingTranscript = pending && lastTurn && (lastTurn.rawText || lastTurn.text) === pending.text;
  const committed = pendingTranscript ? turns.slice(0, -1) : turns;
  const answerCount = committed.length;
  const matchesScript = committed.every((segment, index) => (segment.rawText || segment.text) === JUDGE_DEMO.answers[index])
    && (!pending || pending.text === JUDGE_DEMO.answers[answerCount]);
  return { answerCount, matchesScript, nextAnswer: pending?.text ?? JUDGE_DEMO.answers[answerCount] };
}
