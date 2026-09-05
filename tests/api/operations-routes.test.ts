import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { POST as bootstrap } from "../../src/app/api/auth/bootstrap/route";
import { GET as list, POST as create } from "../../src/app/api/interviews/route";
import { GET as evaluations } from "../../src/app/api/interview-evaluations/route";
import { POST as speech } from "../../src/app/api/voice/speech/route";
import { ConsentService } from "../../src/server/consent-service";
import * as speechProvider from "../../src/server/question-speech";
import { GET as getDraft, PUT as saveDraft } from "../../src/app/api/interviews/[id]/consultation-draft/route";
import { emptyConsultationDraft } from "../../src/domain/consultation-draft";
import { AuthService } from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const globals = globalThis as typeof globalThis & { __donghaengDatabase?: DatabaseSync; __donghaengAuthService?: AuthService; __donghaengInterviewService?: InterviewService };
let cookie = "";
let interviewId = "";
const origin = "http://localhost";
function request(path: string, method = "GET", body?: unknown, withCookie = true) {
  return new Request(`${origin}/api${path}`, { method, headers: { origin, "content-type": "application/json", ...(withCookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function context() { return { params: Promise.resolve({ id: interviewId }) }; }
beforeEach(async () => {
  const db = createInMemoryDatabase();
  globals.__donghaengDatabase = db;
  globals.__donghaengAuthService = new AuthService(db);
  globals.__donghaengInterviewService = new InterviewService(new InterviewRepository(db));
  const auth = await bootstrap(request("/auth/bootstrap", "POST", {}, false));
  cookie = auth.headers.get("set-cookie")!.split(";", 1)[0];
  const response = await create(request("/interviews", "POST", { industryCode: "BEAUTY", profile: { borrowerName: "테스트 사장님", businessName: "API 검증 가게" } }));
  interviewId = (await response.json()).data.session.id;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  globals.__donghaengDatabase?.close();
  delete globals.__donghaengDatabase; delete globals.__donghaengAuthService; delete globals.__donghaengInterviewService;
});

describe("administrator operations and draft HTTP routes", () => {
  it("checks cloud speech consent before synthesis and after revocation", async () => {
    vi.stubEnv("DONGHAENG_TTS_ENDPOINT", "https://api.openai.com/v1/audio/speech");
    const synthesize = vi.spyOn(speechProvider, "synthesizeQuestionSpeech").mockResolvedValue({ bytes: new Uint8Array([82,73,70,70]), contentType: "audio/wav" });
    const body = { text: "사장님이 알려주신 월 매출을 확인할게요.", interviewId };
    expect((await speech(request("/voice/speech", "POST", body, false))).status).toBe(401);
    expect((await speech(request("/voice/speech", "POST", { text: body.text }))).status).toBe(403);
    expect((await speech(request("/voice/speech", "POST", body))).status).toBe(403);
    expect(synthesize).not.toHaveBeenCalled();
    const actual = globals.__donghaengAuthService!.authenticate(request("/interviews"));
    const consent = new ConsentService(globals.__donghaengDatabase!);
    consent.record(interviewId, { purpose: "CLOUD_AI_PROCESSING", consentVersion: "test-v1", granted: true, expiresAt: null }, actual);
    const accepted = await speech(request("/voice/speech", "POST", body));
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("x-speech-provider")).toBe("openai");
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(synthesize).toHaveBeenCalledTimes(1);
    consent.record(interviewId, { purpose: "CLOUD_AI_PROCESSING", consentVersion: "test-v1", granted: false, expiresAt: null }, actual);
    expect((await speech(request("/voice/speech", "POST", body))).status).toBe(403);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect((await speech(request("/voice/speech", "POST", { text: speechProvider.PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST[0] }))).status).toBe(200);
    expect((await speech(request("/voice/speech", "POST", { ...body, interviewId: "different-tenant-id" }))).status).toBe(404);
  });
  it("validates completed-record pagination and requires an operator", async () => {
    expect((await evaluations(request("/interview-evaluations", "GET", undefined, false))).status).toBe(401);
    const response = await evaluations(request("/interview-evaluations?limit=1&offset=0"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { total: 0, limit: 1, offset: 0, items: [] } });
    for (const query of ["limit=0", "limit=101", "limit=", "offset=-1", "offset=100001", "offset=1.5", "limit=1e2", "from=2026-02-30", "from=2026-09-05&to=2026-09-04"]) {
      expect((await evaluations(request(`/interview-evaluations?${query}`))).status, query).toBe(400);
    }
    const actual = globals.__donghaengAuthService!.authenticate(request("/interviews"));
    vi.spyOn(globals.__donghaengAuthService!, "authenticate").mockReturnValue({ ...actual, roles: ["BORROWER"] });
    expect((await evaluations(request("/interview-evaluations"))).status).toBe(403);
  });
  it("requires authentication for reading cases and reading/writing drafts", async () => {
    expect((await list(request("/interviews", "GET", undefined, false))).status).toBe(401);
    expect((await getDraft(request(`/interviews/${interviewId}/consultation-draft`, "GET", undefined, false), context())).status).toBe(401);
    expect((await saveDraft(request(`/interviews/${interviewId}/consultation-draft`, "PUT", { expectedRevision: 0, data: emptyConsultationDraft() }, false), context())).status).toBe(401);
  });
  it("returns real cases in a no-store envelope and validates bounded filters", async () => {
    const response = await list(request("/interviews?status=ACTIVE&q=API&limit=1"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ data: { total: 1, items: [{ id: interviewId, businessName: "API 검증 가게" }], hasMore: false }, error: null, meta: { requestId: expect.any(String) } });
    for (const query of ["limit=0", "limit=101", "offset=-1", "offset=1.2", "status=FAKE", `q=${"x".repeat(101)}`]) {
      expect((await list(request(`/interviews?${query}`))).status, query).toBe(400);
    }
  });
  it("saves, reloads and reports 409 without losing the server draft", async () => {
    const path = `/interviews/${interviewId}/consultation-draft`;
    const data = { ...emptyConsultationDraft(), proposalId: "a-candidate" };
    const save = await saveDraft(request(path, "PUT", { expectedRevision: 0, data }), context());
    expect(save.status).toBe(200);
    const reload = await getDraft(request(path), context());
    expect((await reload.json()).data).toMatchObject({ interviewId, revision: 1, data });
    const conflict = await saveDraft(request(path, "PUT", { expectedRevision: 0, data: { ...data, proposalId: "another" } }), context());
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("CONSULTATION_DRAFT_CONFLICT");
    expect((await (await getDraft(request(path), context())).json()).data.data).toEqual(data);
  });
  it("rejects cross-origin writes before changing stored data", async () => {
    const response = await saveDraft(new Request(`${origin}/api/interviews/${interviewId}/consultation-draft`, { method: "PUT", headers: { cookie, origin: "https://other.example", "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, data: emptyConsultationDraft() }) }), context());
    expect(response.status).toBe(403);
    expect((await (await getDraft(request(`/interviews/${interviewId}/consultation-draft`), context())).json()).data.revision).toBe(0);
  });
  it("rejects malformed drafts and undeclared command fields", async () => {
    const path = `/interviews/${interviewId}/consultation-draft`;
    for (const body of [{ expectedRevision: "0", data: emptyConsultationDraft() }, { expectedRevision: 0, data: {} }, { expectedRevision: 0, data: emptyConsultationDraft(), autoApprove: true }]) {
      expect((await saveDraft(request(path, "PUT", body), context())).status).toBe(400);
    }
  });
  it("denies caller-supplied roles and other-tenant record access", async () => {
    const actual = globals.__donghaengAuthService!.authenticate(request("/interviews"));
    const authenticate = vi.spyOn(globals.__donghaengAuthService!, "authenticate");
    authenticate.mockReturnValue({ ...actual, roles: ["BORROWER"] });
    expect((await list(request("/interviews"))).status).toBe(403);
    expect((await getDraft(request(`/interviews/${interviewId}/consultation-draft`), context())).status).toBe(403);
    authenticate.mockReturnValue({ ...actual, tenantId: "unrelated-tenant" });
    expect((await getDraft(request(`/interviews/${interviewId}/consultation-draft`), context())).status).toBe(404);
  });
});
