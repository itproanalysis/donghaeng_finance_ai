import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  cachedQuestionVoiceChunk,
  predictCanonicalNextQuestions,
  prefetchQuestionVoiceFirstChunks,
  shouldAutoPlayQuestionVoice,
  splitQuestionForSpeech,
} from "@/components/question-voice-playback";
import { DEV_V1_INFORMATION_CATALOG } from "@/domain/information-catalog";

const source = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);

describe("borrower realtime conversation", () => {
  it("uses sentence-first cached TTS and continues into automatic listening", () => {
    expect(source).toContain('const QUESTION_SPEECH_ENDPOINT = "/api/voice/speech"');
    expect(source).toContain("authenticatedFetch(QUESTION_SPEECH_ENDPOINT");
    expect(source).toContain("unlockQuestionVoice();");
    expect(source).toContain("setVoiceAutoplayEnabled(true);");
    expect(source).toContain("currentQuestionVoicePlayback()");
    expect(source).toContain("unlockQuestionVoicePlayback()");
    expect(source).toContain("splitQuestionForSpeech(questionToSpeak)");
    expect(source).toContain("const loadChunk = (chunk: string) => cachedQuestionVoiceChunk(");
    expect(source).toContain("predictCanonicalNextQuestions(live.currentQuestionInfoCode");
    expect(source).toContain("prefetchQuestionVoiceFirstChunks(predictedNextQuestions");
    expect(source).toContain("context.decodeAudioData(voice.bytes.slice(0))");
    expect(source).toContain('if (context?.state === "suspended")');
    expect(source).toContain("await context.resume().catch(() => undefined)");
    expect(source).toContain("if (!controller.signal.aborted)");
    expect(source).toContain("speechAbortRef.current === controller");
    expect(source).toContain("setVoiceListenSignal((value) => value + 1)");
    expect(source).toContain("autoStartSignal={voiceListenSignal}");
    expect(source).toContain("onRecognizedTranscript={(text) => {");
    expect(source).toContain("setOptimisticAnswer(text);");
    expect(source).toContain("void speakQuestion(turnBackchannel);");
    expect(source).toContain("사장님 답변 · 들었어요");
    expect(source).toContain("답변의 맥락을 정리하고 다음 질문을 준비하고 있어요.");
    expect(source).toContain("음성 대화 시작");
    expect(source).toContain("const [voiceAutoplayEnabled, setVoiceAutoplayEnabled] = useState(false)");
    expect(source).toContain("const retainedVoiceContext = currentQuestionVoicePlayback()");
    expect(source).toContain('retainedVoiceContext.state === "running"');
    expect(source).toContain("setVoiceAutoplayEnabled(false)");
    expect(source).toContain("const questionPresentation = presentedQuestion({");
    expect(source).toContain("const question = questionPresentation.text");
    expect(source).toContain("externalQuestionVoiceActive={speechPreparing || speaking}");
    expect(source).toContain("onQuestionVoiceInterrupt={interruptQuestionAndListen}");
    expect(source).toContain("const voiceControlDisabled = !live || sending || !question");
    expect(source).toContain("disabled={voiceControlDisabled}");
    expect(source).toContain("void speakQuestion(question);");
    expect(source).not.toContain('status.uxState === "LISTENING") stopSpeaking()');
  });

  it("finishes the acknowledgement before playing the latest question once", () => {
    const ready = {
      method: "voice" as const,
      voiceAutoplayEnabled: true,
      promptToSpeak: "다음 질문입니다.",
      speaking: false,
      speechPreparing: false,
      voiceBusy: false,
      lastSpokenQuestion: "이전 질문입니다.",
    };

    expect(shouldAutoPlayQuestionVoice({ ...ready, speechPreparing: true })).toBe(false);
    expect(shouldAutoPlayQuestionVoice({ ...ready, speaking: true })).toBe(false);
    expect(shouldAutoPlayQuestionVoice({ ...ready, voiceBusy: true })).toBe(false);
    expect(shouldAutoPlayQuestionVoice(ready)).toBe(true);
    expect(shouldAutoPlayQuestionVoice({
      ...ready,
      lastSpokenQuestion: ready.promptToSpeak,
    })).toBe(false);
  });

  it("makes a durable pending answer visible and retries the exact command", () => {
    expect(source).toContain("retryCommand: PendingMessageCommandView | null = null");
    expect(source).toContain("borrowerMessageCommandPayload(command)");
    expect(source).toContain('retryCommand.processingState !== "READY"');
    expect(source).toContain("live.pendingCommand?.clientMessageId !== retryCommand.clientMessageId");
    expect(source).toContain("사장님의 답변은 이미 안전하게 저장됐습니다.");
    expect(source).toContain("같은 답변 다시 정리");
    expect(source).toContain("void submitAnswer(pendingCommand.text, pendingCommand)");
  });

  it("starts a short first phrase and reuses cached replay audio", async () => {
    const chunks = splitQuestionForSpeech(
      "안녕하세요, 사장님. 오늘은 최근 사업 운영 상황을 편하게 듣고 필요한 정보를 함께 정리해 볼게요. 최근 매출에서 가장 크게 달라진 점은 무엇인가요?",
      48,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 48)).toBe(true);

    const loader = vi.fn(async () => ({
      bytes: new ArrayBuffer(4),
      contentType: "audio/wav",
    }));
    const key = `반복 재생 캐시 ${crypto.randomUUID()}`;
    await cachedQuestionVoiceChunk(key, loader);
    await cachedQuestionVoiceChunk(key, loader);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("predicts only the next eligible canonical core question", () => {
    const items = DEV_V1_INFORMATION_CATALOG.map((definition) => ({
      infoCode: definition.infoCode,
      status: definition.infoCode === "monthly_average_sales" ? "ASKING" : "NEEDED",
      category: definition.category,
      priority: definition.priority,
    }));

    expect(predictCanonicalNextQuestions("monthly_average_sales", items)).toEqual([
      DEV_V1_INFORMATION_CATALOG.find(
        (definition) => definition.infoCode === "fixed_operating_costs",
      )?.question,
    ]);

    const improvementFirst = items.map((item) => ({
      ...item,
      status: item.infoCode === "improvement_plan" ? "ASKING" : "NEEDED",
    }));
    expect(predictCanonicalNextQuestions("improvement_plan", improvementFirst)).toEqual([
      DEV_V1_INFORMATION_CATALOG.find(
        (definition) => definition.infoCode === "execution_readiness",
      )?.question,
    ]);

    const futureFirst = items.map((item) => ({
      ...item,
      status: item.infoCode === "confirmed_reservations" ? "ASKING" : "NEEDED",
    }));
    expect(predictCanonicalNextQuestions("confirmed_reservations", futureFirst)).toEqual([
      DEV_V1_INFORMATION_CATALOG.find(
        (definition) => definition.infoCode === "seasonality_outlook",
      )?.question,
    ]);

    const withPendingFollowup = items.map((item) =>
      item.infoCode === "improvement_plan"
        ? { ...item, status: "NEEDS_FOLLOWUP" }
        : item,
    );
    expect(
      predictCanonicalNextQuestions("monthly_average_sales", withPendingFollowup),
    ).toEqual([]);
    expect(predictCanonicalNextQuestions("industry_only_question", items)).toEqual([]);
  });

  it("prefetches only the first chunk and reuses the bounded voice cache", async () => {
    const text = `예측 음성 ${crypto.randomUUID()}. ${"다음 질문을 미리 준비합니다. ".repeat(8)}`;
    const firstChunk = splitQuestionForSpeech(text)[0];
    const loader = vi.fn(async () => ({
      bytes: new ArrayBuffer(8),
      contentType: "audio/wav",
    }));

    await prefetchQuestionVoiceFirstChunks([text], loader);
    await cachedQuestionVoiceChunk(firstChunk, loader);

    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(firstChunk);
  });
});
