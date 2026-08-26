import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors";
import {
  inspectPersistentQuestionSpeechCache,
  PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST,
  synthesizeQuestionSpeech,
} from "@/server/question-speech";

const environment = {
  DONGHAENG_TTS_ENDPOINT: "http://127.0.0.1:8766/v1/audio/speech",
  DONGHAENG_TTS_API_KEY: "test-key",
};

function persistentText(index: number): string {
  const text = PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST[index];
  if (!text) throw new Error(`missing persistent question speech fixture ${index}`);
  return text;
}

describe("question speech proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prewarms the finite conflict templates instead of synthesizing them mid-interview", () => {
    expect(PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^기존 자료와 차이가 있습니다\..+산정 기준을 확인해 주세요\.$/),
        expect.stringMatching(/^기존 자료와 차이가 있습니다\..+기준 기간과 포함된 매출 채널을 확인해 주세요\.$/),
      ]),
    );
  });

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

  it("coalesces five concurrent identical speech requests into one GPU call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { "content-type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const text = `동시 음성 요청 ${crypto.randomUUID()}`;
    const calls = Array.from({ length: 5 }, () =>
      synthesizeQuestionSpeech(text, {
        environment,
        persistentCacheDirectory: null,
      })
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    release();

    const results = await Promise.all(calls);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(results).toHaveLength(5);
    expect(results.every((result) => result.bytes.byteLength === 4)).toBe(true);
  });

  it("fails closed when the upstream response is not audio", async () => {
    await expect(synthesizeQuestionSpeech("질문", {
      environment,
      fetchImpl: async () => new Response("not audio", { headers: { "content-type": "application/json" } }),
    })).rejects.toMatchObject({ code: "QUESTION_TTS_INVALID_RESPONSE" } satisfies Partial<ApplicationError>);
  });

  it("reuses an allow-listed disk entry after the in-memory process cache is bypassed", async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "donghaeng-question-speech-"));
    const text = persistentText(0);
    const model = "Qwen/test-persistent-model";
    const voice = "Sohee-test";
    const persistentEnvironment = {
      ...environment,
      DONGHAENG_TTS_MODEL: model,
      DONGHAENG_TTS_VOICE: voice,
    };
    const expectedKey = createHash("sha256")
      .update(model, "utf8")
      .update("\u0000", "utf8")
      .update(voice, "utf8")
      .update("\u0000", "utf8")
      .update(text, "utf8")
      .digest("hex");
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([82, 73, 70, 70, 1]), {
        headers: { "content-type": "audio/wav" },
      })
    );

    try {
      const first = await synthesizeQuestionSpeech(text, {
        environment: persistentEnvironment,
        fetchImpl,
        persistentCacheDirectory: cacheDirectory,
      });
      expect([...first.bytes]).toEqual([82, 73, 70, 70, 1]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(await readdir(cacheDirectory)).toEqual([`${expectedKey}.wav`]);

      const restartedFetch = vi.fn(async () => {
        throw new Error("disk hit must not reach Qwen");
      });
      const second = await synthesizeQuestionSpeech(text, {
        environment: persistentEnvironment,
        fetchImpl: restartedFetch,
        persistentCacheDirectory: cacheDirectory,
      });

      expect(restartedFetch).not.toHaveBeenCalled();
      expect(second.contentType).toBe("audio/wav");
      expect([...second.bytes]).toEqual([82, 73, 70, 70, 1]);

      const matchingCoverage = await inspectPersistentQuestionSpeechCache({
        environment: persistentEnvironment,
        persistentCacheDirectory: cacheDirectory,
      });
      expect(matchingCoverage.cached).toBe(1);
      expect(matchingCoverage.total).toBe(PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST.length);
      expect(matchingCoverage.missingTexts).not.toContain(text);

      const otherModelCoverage = await inspectPersistentQuestionSpeechCache({
        environment: {
          ...persistentEnvironment,
          DONGHAENG_TTS_MODEL: "Qwen/a-different-cache-key",
        },
        persistentCacheDirectory: cacheDirectory,
      });
      expect(otherModelCoverage.cached).toBe(0);
      expect(otherModelCoverage.missingTexts).toContain(text);
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it("never writes arbitrary or user-derived speech text to disk", async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "donghaeng-question-speech-"));
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { "content-type": "audio/wav" },
      })
    );

    try {
      await synthesizeQuestionSpeech("사장님 답변에서 동적으로 만든 개인화 문장입니다.", {
        environment,
        fetchImpl,
        persistentCacheDirectory: cacheDirectory,
      });
      await synthesizeQuestionSpeech("사장님 답변에서 동적으로 만든 개인화 문장입니다.", {
        environment,
        fetchImpl,
        persistentCacheDirectory: cacheDirectory,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(await readdir(cacheDirectory)).toEqual([]);
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized persistent entry before reading it as audio", async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "donghaeng-question-speech-"));
    const text = persistentText(1);
    const model = "Qwen/test-size-model";
    const voice = "Sohee-size-test";
    const cacheKey = createHash("sha256")
      .update(model, "utf8")
      .update("\u0000", "utf8")
      .update(voice, "utf8")
      .update("\u0000", "utf8")
      .update(text, "utf8")
      .digest("hex");
    const cacheFile = path.join(cacheDirectory, `${cacheKey}.wav`);
    await writeFile(cacheFile, new Uint8Array(8 * 1024 * 1024 + 1));
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([82, 73, 70, 70, 2]), {
        headers: { "content-type": "audio/wav" },
      })
    );

    try {
      const result = await synthesizeQuestionSpeech(text, {
        environment: {
          ...environment,
          DONGHAENG_TTS_MODEL: model,
          DONGHAENG_TTS_VOICE: voice,
        },
        fetchImpl,
        persistentCacheDirectory: cacheDirectory,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect([...result.bytes]).toEqual([82, 73, 70, 70, 2]);
      expect((await stat(cacheFile)).size).toBe(5);
    } finally {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  });
});
