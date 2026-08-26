import { describe, expect, it, vi } from "vitest";

import {
  OpenAIRealtimeSessionIssuer,
  openAIRealtimeSessionConfig,
} from "@/server/openai-realtime-session";

describe("OpenAI Realtime session issuer", () => {
  it("fails closed when no server-side OpenAI key is configured", async () => {
    const issuer = new OpenAIRealtimeSessionIssuer({ apiKey: null });
    await expect(issuer.issue({ interviewId: "iv-1", userId: "user-1" }))
      .rejects.toMatchObject({
        status: 503,
        code: "OPENAI_REALTIME_NOT_CONFIGURED",
      });
  });

  it("mints a short-lived browser secret without returning the standard key", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({
        value: "ek_ephemeral_only",
        expires_at: 1_800_000_000,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const issuer = new OpenAIRealtimeSessionIssuer({
      apiKey: "sk-test-standard-server-key-1234567890",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await issuer.issue({ interviewId: "iv-1", userId: "raw-user-id" });
    expect(result).toEqual({
      value: "ek_ephemeral_only",
      expiresAt: 1_800_000_000,
      model: "gpt-realtime-2.1",
      voice: "marin",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test-standard-server-key-1234567890");
    expect(headers.get("OpenAI-Safety-Identifier")).toMatch(/^donghaeng-[a-f0-9]{32}$/);
    expect(headers.get("OpenAI-Safety-Identifier")).not.toContain("raw-user-id");
    expect(String(init?.body)).not.toContain("sk-test-standard-server-key");
  });

  it("configures direct audio, Korean transcription, semantic VAD, and low reasoning", () => {
    const config = openAIRealtimeSessionConfig();
    const session = config.session as Record<string, unknown>;
    expect(session.model).toBe("gpt-realtime-2.1");
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.reasoning).toEqual({ effort: "low" });
    const audio = session.audio as Record<string, unknown>;
    const input = audio.input as Record<string, unknown>;
    expect(input.transcription).toMatchObject({ model: "gpt-transcribe", language: "ko" });
    expect(input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "auto",
      create_response: true,
      interrupt_response: true,
    });
    expect(audio.output).toEqual({ voice: "marin" });
  });

  it("rate limits repeated session minting for one interview and user", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({
        value: "ek_ephemeral_only",
        expires_at: 1_800_000_000,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const issuer = new OpenAIRealtimeSessionIssuer({
      apiKey: "sk-test-standard-server-key-1234567890",
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 10_000,
    });
    for (let index = 0; index < 6; index += 1) {
      await issuer.issue({ interviewId: "iv-1", userId: "user-1" });
    }
    await expect(issuer.issue({ interviewId: "iv-1", userId: "user-1" }))
      .rejects.toMatchObject({ status: 429, code: "OPENAI_REALTIME_RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
