import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors";
import { synthesizeQuestionSpeech } from "@/server/question-speech";

const environment = {
  DONGHAENG_TTS_ENDPOINT: "http://127.0.0.1:8766/v1/audio/speech",
  DONGHAENG_TTS_API_KEY: "test-key",
};

describe("question speech proxy", () => {
  it("keeps the local TTS credential server-side and returns bounded audio", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8766/v1/audio/speech");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({ input: "질문을 읽어 주세요.", response_format: "wav" });
      return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } });
    });

    const result = await synthesizeQuestionSpeech(" 질문을 읽어 주세요. ", { environment, fetchImpl });

    expect(result.contentType).toBe("audio/wav");
    expect([...result.bytes]).toEqual([82, 73, 70, 70]);
  });

  it("fails closed when the upstream response is not audio", async () => {
    await expect(synthesizeQuestionSpeech("질문", {
      environment,
      fetchImpl: async () => new Response("not audio", { headers: { "content-type": "application/json" } }),
    })).rejects.toMatchObject({ code: "QUESTION_TTS_INVALID_RESPONSE" } satisfies Partial<ApplicationError>);
  });
});
