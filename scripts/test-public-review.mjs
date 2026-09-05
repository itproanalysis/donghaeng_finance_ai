// Explicit deployment acceptance test. Creates two isolated QA visitor records.
// --live permits one paid AI answer and one short TTS synthesis; no real microphone.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const origin = process.argv[2];
if (!origin || !/^https:\/\/donghaeng-finance-review-[a-z0-9.-]+\.run\.app$/.test(origin)) throw new Error("Explicit isolated review URL required");
const live = process.argv.includes("--live");
async function api(path, { cookie, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(45_000),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === "GET" ? {} : { Origin: origin, "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.clone().json().catch(() => null);
  return { response, json, data: json?.data };
}
const home = await api("/");
assert.equal(home.response.status, 200);
const homeHtml = await home.response.text();
assert.match(homeHtml, /data-auth-mode="public-review"/);
assert.match(homeHtml, /가입 없이 바로 체험/);
assert.match(homeHtml, /평가 사례 살펴보기/);
assert.match(homeHtml, /href="\/about"/);
const about = await api("/about");
assert.equal(about.response.status, 200);
const aboutHtml = await about.response.text();
assert.match(aboutHtml, /사용자 · 소상공인/);
assert.match(aboutHtml, /운영자 · 상담·검토 담당자/);
const impact = await api("/modeling?case=case_operating_drop&tab=impact");
assert.equal(impact.response.status, 200);
const impactHtml = await impact.response.text();
assert.match(impactHtml, /id="modeling-tab-impact"[^>]*aria-selected="true"/);
assert.match(impactHtml, /54 ÷ 80 × 100 = 67.5/);
for (const [tab, heading] of [["goals", "목표와 수행기록"], ["reevaluation", "수행자료 반영 후 재평가"], ["report", "기관 검토용 요약"]]) {
  const page = await api(`/modeling?case=case_operating_drop&tab=${tab}`);
  assert.equal(page.response.status, 200);
  const html = await page.response.text();
  assert.match(html, new RegExp(`id="modeling-tab-${tab}"[^>]*aria-selected="true"`));
  assert.ok(html.includes(heading));
}
const noFollowup = await api("/modeling?case=case_no_answer&tab=reevaluation");
assert.match(await noFollowup.response.text(), /아직 재평가할 후속 자료가 없습니다/);
const quickEntry = await api("/borrower?entry=sample");
assert.equal(quickEntry.response.status, 200);
const quickHtml = await quickEntry.response.text();
assert.match(quickHtml, /체험용 가상 카페/);
assert.match(quickHtml, /채팅으로 답변/);
const consentInput = quickHtml.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0];
assert.ok(consentInput);
assert.doesNotMatch(consentInput, /checked/);
for (const demoSet of ["primary", "control"]) {
  const scenarioPage = await api(`/borrower?scenario=operating-day&demoSet=${demoSet}`);
  assert.equal(scenarioPage.response.status, 200);
  const scenarioHtml = await scenarioPage.response.text();
  assert.match(scenarioHtml, /합성 시연/);
  assert.match(scenarioHtml, /채팅으로 답변/);
  assert.doesNotMatch(scenarioHtml, /음성으로 답변/);
  const scenarioConsent = scenarioHtml.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0];
  assert.ok(scenarioConsent);
  assert.doesNotMatch(scenarioConsent, /checked/);
}
const scoringPage = await api("/modeling?case=case_operating_drop&tab=score");
assert.equal(scoringPage.response.status, 200);
assert.match(await scoringPage.response.text(), /id="modeling-tab-score"[^>]*aria-selected="true"/);
const loginEntry = await api("/login?next=%2Fborrower");
assert.equal(loginEntry.response.status, 307);
assert.equal(new URL(loginEntry.response.headers.get("location"), origin).href, origin + "/borrower");
const modelingPage = await api("/modeling?case=case_operating_drop");
assert.equal(modelingPage.response.status, 200);
assert.match(await modelingPage.response.text(), /id="modeling-heading"/);
const modelingIndex = await api("/api/demo/modeling");
assert.equal(modelingIndex.response.status, 200);
assert.equal(modelingIndex.data.schemaVersion, "modeling_web_v1");
assert.equal(modelingIndex.data.defaultCaseId, "case_operating_drop");
assert.equal(modelingIndex.data.model.featureCount, 94);
assert.equal(modelingIndex.data.cases.length, 10);
assert.equal(modelingIndex.data.validation.existingModelingValidation.checksPassed, 82);
assert.equal(modelingIndex.data.reevaluation.monthlyRecords.length, 6);
const goalMonths = modelingIndex.data.reevaluation.monthlyRecords.filter(row => row.includedInGoal);
assert.equal(goalMonths.length, 3);
assert.equal(goalMonths.reduce((sum, row) => sum + row.operatingDays, 0) / 3, modelingIndex.data.reevaluation.after);
const modelingCase = await api("/api/demo/modeling/case_operating_drop");
assert.equal(modelingCase.response.status, 200);
assert.equal(modelingCase.data.features.length, 94);
assert.equal(modelingCase.data.scorecard.currentSituation.score, 78);
assert.equal(modelingCase.data.scorecard.improvement.score, 67.5);
assert.equal(modelingCase.data.modelingEffect.caseId, "case_operating_drop");
assert.equal(modelingCase.data.modelingEffect.structuredInputsUnchanged, true);
assert.equal(modelingCase.data.modelingEffect.before.scorecard.improvement.accounting.availablePoints, 60);
assert.equal(modelingCase.data.modelingEffect.after.scorecard.improvement.accounting.availablePoints, 80);
assert.equal(modelingCase.data.externalContext.includedInFeatureVector, false);
assert.equal(modelingCase.data.externalContext.includedInScore, false);
assert.equal((await api("/api/demo/modeling/not-a-case")).response.status, 404);
assert.equal((await api("/api/auth/me")).response.status, 401);
const a = await api("/api/auth/visitor-session", { method: "POST", body: {} });
const b = await api("/api/auth/visitor-session", { method: "POST", body: {} });
assert.equal(a.response.status, 200); assert.equal(b.response.status, 200);
assert.notEqual(a.data.principal.tenantId, b.data.principal.tenantId);
assert.deepEqual(a.data.principal.roles, ["INTERVIEWER"]);
const setCookie = a.response.headers.get("set-cookie");
assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=Lax/i);
const cookieA = setCookie.split(";")[0];
const cookieB = b.response.headers.get("set-cookie").split(";")[0];
const repeat = await api("/api/auth/visitor-session", { method: "POST", body: {}, cookie: cookieA });
assert.equal(repeat.data.principal.tenantId, a.data.principal.tenantId);
assert.equal(repeat.response.headers.get("set-cookie"), null);
for (const path of ["/api/auth/bootstrap", "/api/admin/retention"]) {
  assert.equal((await api(path, { method: "POST", body: {}, cookie: cookieA })).response.status, 403);
}
assert.equal((await api("/api/auth/session", { method: "POST", body: { email: "local@donghaeng.workspace", password: "unused" }, cookie: cookieA })).response.status, 403);
assert.equal((await api("/api/auth/visitor-session", { method: "POST", body: {}, headers: { Origin: "https://attacker.invalid" } })).response.status, 403);
const created = await api("/api/interviews", { method: "POST", cookie: cookieA, body: { profile: { borrowerName: "접속 검증", businessName: "격리 검증용 기록" } } });
assert.equal(created.response.status, 201, JSON.stringify(created.json));
const id = created.data.session.id;
for (const path of [`/api/interviews/${id}`, `/api/interviews/${id}/information-items`, `/api/interviews/${id}/consents`, `/api/interviews/${id}/consultation-draft`, `/api/interviews/${id}/events`]) {
  assert.equal((await api(path, { cookie: cookieB })).response.status, 404, path);
}
assert.equal((await api(`/api/interviews/${id}/realtime-session`, { method: "POST", cookie: cookieB, body: {} })).response.status, 404);
assert.equal((await api(`/api/interviews/${id}/realtime-call`, { method: "POST", cookie: cookieB, body: { sdp: "v=0" } })).response.status, 404);
assert.equal((await api(`/api/interviews/${id}/realtime-session`, { method: "POST", cookie: cookieA, body: {} })).response.status, 403);
const wsStatus = await new Promise((resolve, reject) => {
  const ws = new WebSocket(origin.replace("https:", "wss:") + `/ws/interviews/${id}/audio`, { headers: { Origin: origin, Cookie: cookieB }, handshakeTimeout: 10_000 });
  ws.on("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode); ws.terminate(); });
  ws.on("open", () => { ws.close(); reject(new Error("Cross-visitor WS opened")); });
  ws.on("error", error => { if (!String(error.message).includes("closed before")) reject(error); });
});
assert.equal(wsStatus, 404);
for (const [purpose, consentVersion] of [["CLOUD_AI_PROCESSING", "cloud-ai-processing-v1"], ["MICROPHONE_INTERVIEW", "microphone-interview-v1"]]) {
  assert.equal((await api(`/api/interviews/${id}/consents`, { method: "POST", cookie: cookieA, body: { purpose, consentVersion, granted: true, expiresAt: null } })).response.status, 201);
}
const transport = await api(`/api/interviews/${id}/realtime-session`, { method: "POST", cookie: cookieA, body: {} });
assert.equal(transport.data.transport, "server"); assert.equal(transport.data.value, undefined);
assert.equal((await api(`/api/interviews/${id}/realtime-call`, { method: "POST", cookie: cookieA, body: { sdp: "invalid" } })).response.status, 400);
if (process.argv.includes("--voice")) {
  // Protocol admission + provider hangup only. No device/microphone capture and
  // no claim that media packets were exchanged or a speaker was audible.
  const fingerprint = randomBytes(32).toString("hex").match(/../g).join(":").toUpperCase();
  const transport = [`a=ice-ufrag:${randomBytes(6).toString("hex")}`, `a=ice-pwd:${randomBytes(16).toString("hex")}`,
    `a=fingerprint:sha-256 ${fingerprint}`, "a=setup:actpass"];
  const sdp = ["v=0", "o=- 123456789 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0 1", "a=msid-semantic: WMS test",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0", ...transport, "a=mid:0", "a=sendrecv", "a=rtcp-mux", "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0", ...transport, "a=mid:1", "a=sctp-port:5000", "a=max-message-size:262144", ""].join("\r\n");
  const call = await api(`/api/interviews/${id}/realtime-call`, { method: "POST", cookie: cookieA, body: { sdp } });
  assert.equal(call.response.status, 201, JSON.stringify(call.json));
  assert.ok(call.data.sdp.startsWith("v=0"));
  assert.equal(call.data.value, undefined);
  const ended = await api(`/api/interviews/${id}/realtime-call`, { method: "DELETE", cookie: cookieA, body: { callId: call.data.id } });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.json));
  console.log("Actual provider WebRTC SDP accepted and server hangup acknowledged (no microphone/media test).");
}
if (live) {
  const snapshot = (await api(`/api/interviews/${id}`, { cookie: cookieA })).data;
  const started = Date.now();
  const answer = await api(`/api/interviews/${id}/messages`, { method: "POST", cookie: cookieA, body: {
    text: "최근 3개월 월평균 매출은 2천만 원 정도입니다. 재료비가 올라서 남는 돈이 줄었습니다.", clientMessageId: randomUUID(),
    expectedVersion: snapshot.session.version, currentQuestionInfoCode: snapshot.nextQuestion?.infoCode ?? null,
  } });
  assert.equal(answer.response.status, 200, JSON.stringify(answer.json));
  console.log(`Actual AI answer accepted in ${Date.now() - started} ms`);
  const speech = await api("/api/voice/speech", { method: "POST", cookie: cookieA, body: { interviewId: id, text: "안녕하세요. 가게 이야기를 함께 정리해 볼게요." } });
  assert.equal(speech.response.status, 200);
  assert.match(speech.response.headers.get("content-type"), /^audio\//);
  const bytes = (await speech.response.arrayBuffer()).byteLength;
  assert.ok(bytes > 1000); console.log(`Actual TTS: ${bytes} bytes (not a speaker audibility check)`);
}
console.log("PUBLIC REVIEW PASS: no-login quick entry with unchecked consent, deep-linked model tab, local login redirect, anonymous modeling page/API, 94-feature and context-only boundary, guest reuse/isolation, no shared login/admin, CSRF, cross-tenant HTTP/SSE/WS denial, consent and server-only voice transport.");
