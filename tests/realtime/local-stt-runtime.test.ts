import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(
  new URL("../../local_voice/voice_server.py", import.meta.url),
  "utf8",
);
const launcherSource = readFileSync(
  new URL("../../scripts/start-local-korean-stt.ps1", import.meta.url),
  "utf8",
);

describe("local Korean STT realtime profile", () => {
  it("uses bounded greedy decoding for independent answer turns", () => {
    expect(bridgeSource).toContain('"DONGHAENG_LOCAL_STT_BEAM_SIZE", 1, 1, 5');
    expect(bridgeSource).toContain('"condition_on_previous_text": False');
    expect(bridgeSource).toContain('"word_timestamps": False');
    expect(bridgeSource).toContain('"without_timestamps": True');
    expect(bridgeSource).not.toContain("beam_size=5");
  });

  it("keeps VAD tunables bounded and reports the active latency profile", () => {
    expect(bridgeSource).toContain('LATENCY_PROFILE = "realtime-isolated-turn-v1"');
    expect(bridgeSource).toContain('"min_speech_duration_ms": 100');
    expect(bridgeSource).toContain('"max_speech_duration_s": vad_max_speech_seconds');
    expect(bridgeSource).toContain('"latency_profile": app.state.latency_profile');
    expect(launcherSource).toContain("[int]$BeamSize = 1");
    expect(launcherSource).toContain("[int]$VadMinSilenceMs = 300");
  });

  it("preserves the OpenAI-compatible text-only response contract", () => {
    expect(bridgeSource).toContain('return JSONResponse({"text": text})');
    expect(bridgeSource).toContain('detail="LOCAL_STT_NO_SPEECH"');
  });

  it("keeps health responsive while serializing uncancellable GPU transcription", () => {
    expect(bridgeSource).toContain("class FinalPriorityTranscriptionLock:");
    expect(bridgeSource).toContain("app.state.transcription_lock = FinalPriorityTranscriptionLock()");
    expect(bridgeSource).toContain("async with app.state.transcription_lock.hold(final=is_final_request):");
    expect(bridgeSource).toContain("asyncio.to_thread(");
    expect(bridgeSource).toContain("await asyncio.shield(transcription_task)");
    expect(bridgeSource).toContain("while not transcription_task.done():");
    expect(bridgeSource).toContain("except asyncio.CancelledError:");
  });

  it("runs lazy segment iteration on the worker and prioritizes final turn files", () => {
    const helperStart = bridgeSource.indexOf("def transcribe_audio_file(");
    const helperEnd = bridgeSource.indexOf("async def finish_transcription_before_unlocking(");
    const helper = bridgeSource.slice(helperStart, helperEnd);
    expect(helper).toContain("model.transcribe(");
    expect(helper).toContain('return " ".join(');
    expect(bridgeSource).toContain(
      'is_final_request = not (file.filename or "").startswith("interview-partial.")',
    );
    expect(bridgeSource).toContain("(final or self._waiting_finals == 0)");
  });
});
