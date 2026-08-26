import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(
  new URL("../../local_voice/tts_server.py", import.meta.url),
  "utf8",
);
const workspaceLauncher = readFileSync(
  new URL("../../scripts/start-local-workspace.ps1", import.meta.url),
  "utf8",
);
const dedicatedLauncher = readFileSync(
  new URL("../../scripts/start-local-korean-tts.ps1", import.meta.url),
  "utf8",
);
const questionSpeechSource = readFileSync(
  new URL("../../src/server/question-speech.ts", import.meta.url),
  "utf8",
);
const prewarmCli = readFileSync(
  new URL("../../scripts/prewarm-question-speech.ts", import.meta.url),
  "utf8",
);

describe("local Korean TTS realtime profile", () => {
  it("uses the official 0.6B Sohee checkpoint with SDPA for realtime turns", () => {
    expect(bridgeSource).toContain(
      'DEFAULT_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"',
    );
    expect(bridgeSource).toContain('attn_implementation="sdpa"');
    expect(bridgeSource).toContain('"latency_profile": "realtime-0.6b-sdpa-v1"');
    expect(dedicatedLauncher).toContain(
      '$env:DONGHAENG_LOCAL_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"',
    );
  });

  it("does not send unsupported style instructions to the 0.6B checkpoint", () => {
    expect(bridgeSource).toContain('if "1.7B" in model_name:');
    expect(bridgeSource).toContain('generation_options["instruct"]');
    expect(bridgeSource).toContain("**generation_options");
  });

  it("keeps the event loop responsive while serializing uncancellable CUDA work", () => {
    expect(bridgeSource).toContain("asyncio.to_thread(");
    expect(bridgeSource).toContain("await asyncio.shield(generation_task)");
    expect(bridgeSource).toContain("while not generation_task.done():");
    expect(bridgeSource).toContain("async with app.state.lock:");
    expect(bridgeSource).toContain("except asyncio.CancelledError:");
  });

  it("orders the welcome and first canonical question before optional backchannels", () => {
    const sources = questionSpeechSource.slice(
      questionSpeechSource.indexOf("const CANONICAL_BORROWER_SPEECH_SOURCES"),
    );
    const welcome = sources.indexOf("BORROWER_INTERVIEW_WELCOME,");
    const firstQuestion = sources.indexOf("...(FIRST_CANONICAL_QUESTION_SPEECH_TEXT");
    const acknowledgement = sources.indexOf("...BORROWER_TURN_BACKCHANNELS");
    expect(welcome).toBeGreaterThan(-1);
    expect(firstQuestion).toBeGreaterThan(welcome);
    expect(acknowledgement).toBeGreaterThan(firstQuestion);
  });

  it("prewarms every missing allow-listed chunk through the authenticated web route", () => {
    expect(prewarmCli).toContain("inspectPersistentQuestionSpeechCache");
    expect(prewarmCli).toContain("/api/auth/bootstrap");
    expect(prewarmCli).toContain("/api/voice/speech");
    expect(prewarmCli).toContain("for (let index = 0; index < initial.missingTexts.length;");
    expect(prewarmCli).not.toContain("/v1/audio/speech");
    expect(workspaceLauncher).toContain("Invoke-AllBorrowerVoicePrewarm");
    expect(workspaceLauncher).toContain("scripts\\prewarm-question-speech.ts");
  });
});
