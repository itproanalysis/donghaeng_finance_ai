// Read-only/provider canary: run INSIDE the dedicated GCP container via stdin.
// Uses only a synthetic sentence; never prints credentials or provider payloads.
import WebSocket from "ws";
const metadata = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(10000) }).then(r => r.json());
const credentials = {};
for (const [name, secret] of [["anthropic", "donghaeng-anthropic-api-key"], ["openai", "donghaeng-openai-api-key"]]) {
  const response = await fetch(`https://secretmanager.googleapis.com/v1/projects/abis-web-platform/secrets/${secret}/versions/latest:access`, { headers: { Authorization: `Bearer ${metadata.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Secret canary unavailable: ${response.status}`);
  credentials[name] = Buffer.from((await response.json()).payload.data, "base64").toString("utf8").trim();
}
const results = [];
const headers = { Authorization: `Bearer ${credentials.openai}`, "Content-Type": "application/json" };
async function check(name, action) {
  const started = Date.now();
  try { results.push({ name, ...(await action()), elapsedMs: Date.now() - started }); }
  catch { results.push({ name, ok: false, failure: "request_failed", elapsedMs: Date.now() - started }); }
}
await check("claude-sonnet-5", async () => {
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": credentials.anthropic, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 16, messages: [{ role: "user", content: "Reply with OK only. Deployment check." }] }), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  return { ok: response.ok && Array.isArray(body.content), status: response.status, ...(response.ok ? {} : { errorType: body.error?.type }) };
});
await check("gpt-realtime-2.1", async () => {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers, body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: { type: "realtime", model: "gpt-realtime-2.1", audio: { input: { transcription: { model: "gpt-transcribe", language: "ko" } }, output: { voice: "marin" } } } }), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  return { ok: response.ok && typeof body.value === "string", status: response.status, ...(response.ok ? {} : { errorType: body.error?.type }) };
});
let audio;
await check("gpt-4o-mini-tts-marin", async () => {
  const response = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers, body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: "안녕하세요. 음성 연결을 점검합니다.", response_format: "wav" }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) { await response.body?.cancel(); return { ok: false, status: response.status }; }
  audio = new Uint8Array(await response.arrayBuffer());
  return { ok: audio.length > 1000 && Buffer.from(audio.subarray(0, 4)).toString() === "RIFF", status: response.status, bytes: audio.length };
});
if (audio) await check("gpt-transcribe-korean", async () => {
  const form = new FormData();
  form.set("model", "gpt-transcribe");
  form.set("language", "ko");
  form.set("file", new Blob([audio], { type: "audio/wav" }), "deployment-canary.wav");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: headers.Authorization }, body: form, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  return { ok: response.ok && typeof body.text === "string" && body.text.includes("점검"), status: response.status };
});
if (audio) await check("gpt-realtime-speech-to-speech", async () => {
  const wave = Buffer.from(audio);
  let pcm;
  let formatValid = false;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const id = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= wave.length) {
      formatValid = wave.readUInt16LE(start) === 1 && wave.readUInt16LE(start + 2) === 1 && wave.readUInt32LE(start + 4) === 24000 && wave.readUInt16LE(start + 14) === 16;
    }
    if (id === "data") { pcm = wave.subarray(start, Math.min(wave.length, start + size)); break; }
    offset = start + size + size % 2;
  }
  if (!formatValid || !pcm?.length) return { ok: false, failure: "canary_pcm_format" };
  return await new Promise(resolve => {
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1", { headers: { Authorization: headers.Authorization }, maxPayload: 4 * 1024 * 1024, handshakeTimeout: 10000 });
    let finished = false;
    let firstAudioMs = null;
    let sentAt = 0;
    let outputBytes = 0;
    const finish = result => { if (finished) return; finished = true; clearTimeout(timer); ws.close(); resolve(result); };
    const timer = setTimeout(() => { finish({ ok: false, failure: "realtime_timeout" }); ws.terminate(); }, 30000);
    ws.on("error", () => finish({ ok: false, failure: "realtime_connection" }));
    ws.on("close", () => { if (!finished) finish({ ok: false, failure: "realtime_closed" }); });
    ws.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.created") ws.send(JSON.stringify({ type: "session.update", session: { type: "realtime", model: "gpt-realtime-2.1", instructions: "한국어로 음성 점검이 잘 들린다고 한 문장으로 답하세요. 합성 음성을 사용한 연결 점검입니다.", output_modalities: ["audio"], max_output_tokens: 256, audio: { input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: null }, output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" } } } }));
      if (event.type === "session.updated") {
        sentAt = Date.now();
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64") }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        ws.send(JSON.stringify({ type: "response.create" }));
      }
      if (event.type === "response.output_audio.delta") { firstAudioMs ??= Date.now() - sentAt; outputBytes += Buffer.from(event.delta, "base64").length; }
      if (event.type === "response.done") finish({ ok: event.response?.status === "completed" && outputBytes > 1000, outputBytes, firstAudioMs });
      if (event.type === "error") finish({ ok: false, failure: typeof event.error?.code === "string" ? event.error.code : "realtime_provider_error" });
    });
  });
});
console.log(JSON.stringify({ results }, null, 2));
if (results.some(result => !result.ok)) process.exitCode = 1;
