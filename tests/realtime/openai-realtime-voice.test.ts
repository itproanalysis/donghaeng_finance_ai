import { describe, expect, it } from "vitest";

import {
  canonicalQuestionResponseEvent,
  parseRealtimeClientSecret,
  parseRealtimeVoiceEvent,
} from "@/realtime/openai-realtime-voice";

describe("OpenAI Realtime voice browser protocol", () => {
  it("accepts only a bounded ephemeral client secret view", () => {
    expect(parseRealtimeClientSecret({
      value: "ek_test_ephemeral",
      expiresAt: 1_800_000_000,
      model: "gpt-realtime-2.1",
      voice: "marin",
    })).toEqual({
      value: "ek_test_ephemeral",
      expiresAt: 1_800_000_000,
      model: "gpt-realtime-2.1",
      voice: "marin",
    });
    expect(parseRealtimeClientSecret({ value: "", model: "x", voice: "x" })).toBeNull();
  });

  it("parses partial and completed borrower transcripts without using assistant output", () => {
    expect(parseRealtimeVoiceEvent(JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-1",
      delta: "월 매출은 ",
    }))).toEqual({
      type: "INPUT_TRANSCRIPT_DELTA",
      itemId: "item-1",
      delta: "월 매출은 ",
    });
    expect(parseRealtimeVoiceEvent(JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-1",
      transcript: "월 매출은 2천만 원입니다.",
    }))).toEqual({
      type: "INPUT_TRANSCRIPT_DONE",
      itemId: "item-1",
      transcript: "월 매출은 2천만 원입니다.",
    });
    expect(parseRealtimeVoiceEvent(JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "네, 잘 들었습니다.",
    }))).toEqual({
      type: "ASSISTANT_TRANSCRIPT_DONE",
      transcript: "네, 잘 들었습니다.",
    });
  });

  it("supports completed user transcripts attached to a conversation item", () => {
    expect(parseRealtimeVoiceEvent(JSON.stringify({
      type: "conversation.item.done",
      item: {
        id: "item-2",
        role: "user",
        content: [{ type: "input_audio", transcript: "답하기 어렵습니다." }],
      },
    }))).toEqual({
      type: "INPUT_TRANSCRIPT_DONE",
      itemId: "item-2",
      transcript: "답하기 어렵습니다.",
    });
  });

  it("creates a constrained one-question audio response", () => {
    const event = canonicalQuestionResponseEvent(
      "최근 월평균 매출은 어느 정도인가요?",
      "7:monthly_average_sales",
      false,
    );
    expect(event.type).toBe("response.create");
    const response = event.response as Record<string, unknown>;
    expect(response.output_modalities).toEqual(["audio"]);
    expect(String(response.instructions)).toContain("최근 월평균 매출은 어느 정도인가요?");
    expect(String(response.instructions)).toContain("새로운 질문");
    expect(response.metadata).toEqual({
      kind: "canonical_interview_question",
      question_key: "7:monthly_average_sales",
    });
  });
});
