/** Real HTTP integration checks, shared by production E2E and public synthetic QA. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { createBorrowerRequiredInformationList } from "../src/components/borrower-interview-preferences.ts";
import { JUDGE_DEMO } from "../src/domain/judge-demo.ts";
import { RECOVERY_MISSIONS } from "../src/domain/recovery-journey.ts";
import { CONSULTATION_DOCUMENTS, emptyConsultationDraft } from "../src/domain/consultation-draft.ts";

const contract = JSON.parse(readFileSync(new URL("../contracts/openapi.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validators = Object.fromEntries(["DataReviewSuccessEnvelope", "RecoverySuccessEnvelope", "DataReviewListSuccessEnvelope", "ConsultationPackageSuccessEnvelope"].map((name) => [name, ajv.compile({ $schema: contract.jsonSchemaDialect, components: contract.components, $ref: `#/components/schemas/${name}` })]));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export async function requestEngine(origin, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.mutationOrigin) headers.set("origin", options.mutationOrigin);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${origin}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), redirect: "manual", signal: AbortSignal.timeout(45_000) });
  return { response, payload: await response.json().catch(() => null) };
}

export async function verifyDataEngine({ origin, cookie, request = requestEngine }) {
  const checks = [];
  const providers = [];
  const check = (name, condition) => { assert(condition, name); checks.push(name); };
  const runId = randomUUID();
  async function api(path, body, schema, expectedStatus = 200) {
    const result = await request(origin, path, { cookie, method: body === undefined ? "GET" : "POST", mutationOrigin: origin, body });
    assert(result.response.status === expectedStatus && result.payload && !result.payload.error, `${path}: HTTP ${result.response.status} ${JSON.stringify(result.payload?.error)}`);
    if (schema) { const validate = validators[schema]; assert(validate(result.payload), `${schema}: ${JSON.stringify(validate.errors)}`); }
    return result.payload.data;
  }
  let live = await api("/api/interviews", { industryCode: "CAFE", profile: { businessName: JUDGE_DEMO.businessName, borrowerName: JUDGE_DEMO.borrowerName }, requiredInformationList: createBorrowerRequiredInformationList("CAFE", "FULL_REVIEW") }, null, 201);
  const interviewId = live.session.id;
  const base = `/api/interviews/${interviewId}`;
  const initial = await api(`${base}/data-review`, undefined, "DataReviewSuccessEnvelope");
  check("빈 인터뷰: COMPUTED 0 / MISSING 100 / Evidence 0", initial.metrics.computed === 0 && initial.metrics.missing === 100 && initial.metrics.evidence === 0);
  const unauthenticated = await request(origin, `${base}/data-review`);
  check("data-review 익명 접근 차단", unauthenticated.response.status === 401);
  const unfinished = await request(origin, `${base}/consultation-package`, { cookie });
  check("상담 준비서는 FINAL 확인 후 제공", unfinished.response.status === 409 && unfinished.payload?.error?.code === "FINAL_REQUIRED");
  const noPackageSession = await request(origin, `${base}/consultation-package`);
  check("상담 준비서 익명 접근 차단", noPackageSession.response.status === 401);
  await api(`${base}/consents`, { purpose: "CLOUD_AI_PROCESSING", consentVersion: "cloud-ai-processing-v1", granted: true, expiresAt: null }, null, 201);
  for (const [index, text] of JUDGE_DEMO.answers.entries()) {
    const result = await api(`${base}/messages`, { text, clientMessageId: `${runId}-${index}`, expectedVersion: live.session.version, currentQuestionInfoCode: live.nextQuestion?.infoCode ?? null });
    live = result.snapshot;
    const metadata = result.processing?.metadata;
    providers.push({ status: result.processing?.status ?? null, provider: metadata?.provider ?? null, model: metadata?.model ?? null, inputTokens: metadata?.inputTokens ?? null, outputTokens: metadata?.outputTokens ?? null, stopReason: metadata?.stopReason ?? null });
    check(`실제 답변 ${index + 1} → LIVE 갱신`, live.snapshotType === "PREVIEW" && live.session.version > index + 1);
  }
  const review = await api(`${base}/data-review`, undefined, "DataReviewSuccessEnvelope");
  const feature = (name) => review.features.find((item) => item.name === name);
  const canonical = review.canonical.find((item) => item.infoCode === "monthly_average_sales");
  check("23,000,000 KRW: Canonical → fin_sales_avg_3m", canonical.selected.value.amount.value === 23_000_000 && feature("fin_sales_avg_3m").value === 23_000_000);
  check("비율은 기존 서버 산식: 고정비 0.31 / 반복고객 0.50", feature("fin_fixed_cost_ratio").value === .31 && feature("ops_repeat_customer_ratio").value === .5);
  check("수집되지 않은 신용정보는 null / MISSING", feature("crd_credit_score").state === "MISSING" && feature("crd_credit_score").value === null);
  check("100개 Feature의 modelCandidate:false 유지", review.features.length === 100 && review.features.every((item) => item.modelCandidate === false));
  const traced = feature("fin_sales_avg_3m");
  check("Feature → selected revision → 원문 Evidence", traced.traces[0].revisionId === canonical.selectedRevisionId && traced.evidenceIds.some((id) => review.evidence.find((item) => item.id === id)?.originalText === JUDGE_DEMO.answers[0]));
  const signal = feature("imp_sales_recovery_potential");
  check("Signal → source Feature → canonical → Evidence", signal.sourceFeatures.includes("ops_repeat_customer_ratio") && signal.traces.some((trace) => trace.featureNames.includes("ops_repeat_customer_ratio") && trace.infoCode === "repeat_customer_share" && trace.evidenceIds.length > 0) && signal.missingInputs.length > 0);
  const completed = await api(`${base}/complete`, { clientCommandId: `${runId}-final`, expectedVersion: live.session.version, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "합성 시연의 확인한 범위와 누락을 함께 보존하는 검증" });
  check("3답변 FINAL: INCOMPLETE / 평가·신용등급 미생성", completed.snapshot.completionStatus === "INCOMPLETE" && completed.evaluation === null);
  const frozen = await api(`${base}/data-review`, undefined, "DataReviewSuccessEnvelope");
  check("종료 시점 Feature 고정", frozen.featureArtifactOrigin === "FROZEN_FINAL" && JSON.stringify(frozen.features) === JSON.stringify(review.features));
  const beforeAction = await api(`${base}/consultation-package`, undefined, "ConsultationPackageSuccessEnvelope");
  check("미션·계획 선택 없이도 현재 결과로 상담 준비", beforeAction.recovery.selection === null && beforeAction.recovery.evidence.length === 0 && beforeAction.deliveryStatus === "NOT_SENT");
  const recoveryPath = `${base}/recovery`;
  const crossOrigin = await request(origin, recoveryPath, { cookie, method: "POST", mutationOrigin: "https://attacker.invalid", body: { action: "SELECT_ACTION", candidateId: "SKIP", clientCommandId: `${runId}-csrf` } });
  check("Recovery 교차 출처 저장 차단", crossOrigin.response.status === 403 && (!crossOrigin.payload || crossOrigin.payload.error?.code === "CSRF_REJECTED"));
  await api(recoveryPath, { action: "SELECT_ACTION", candidateId: frozen.candidates[0].id, clientCommandId: `${runId}-select` }, "RecoverySuccessEnvelope");
  let recovery;
  for (const mission of RECOVERY_MISSIONS) {
    const command = { action: "ADD_EVIDENCE", missionId: mission.id, title: mission.exampleTitle, note: mission.exampleNote, observedOn: new Date().toISOString().slice(0, 10), expectedRevision: mission.id - 1, clientCommandId: `${runId}-mission-${mission.id}` };
    recovery = await api(recoveryPath, command, "RecoverySuccessEnvelope");
    const replay = await api(recoveryPath, command, "RecoverySuccessEnvelope");
    check(`Mission ${mission.id}: append-only Evidence / 동일 요청 중복 방지`, recovery.evidence.length === mission.id && replay.evidence.length === mission.id && recovery.evidence.at(-1).kind === "SELF_REPORTED");
  }
  check("3개 미션 실제 기록 상태", JSON.stringify(recovery.completedMissionIds) === "[1,2,3]");
  const reviewed = await api(recoveryPath, { action: "REVIEW", status: "NEEDS_INFORMATION", note: "합성 검증: 누락된 입력과 자료의 기준 기간 추가 확인 필요", expectedRevision: 0, clientCommandId: `${runId}-review` }, "RecoverySuccessEnvelope");
  check("담당자 검토는 추가 확인 상태만 기록", reviewed.review.status === "NEEDS_INFORMATION" && reviewed.review.revision === 1);
  const draft = await request(origin, `${base}/consultation-draft`, { cookie, method: "PUT", mutationOrigin: origin, body: { expectedRevision: 0, data: { ...emptyConsultationDraft(), institutionId: "koreg", documents: [CONSULTATION_DOCUMENTS[0]], reviewed: true } } });
  check("기관 선택·일부 준비자료 저장", draft.response.status === 200 && draft.payload?.data?.revision === 1);
  const prepared = await api(`${base}/consultation-package`, undefined, "ConsultationPackageSuccessEnvelope");
  check("상담 자료: 저장된 기관·원문·100개 변수·선택·실행 기록 결합", prepared.draft.data.institutionId === "koreg" && prepared.draft.revision === 1 && prepared.draft.data.documents.length === 1 && prepared.review.features.length === 100 && prepared.review.evidence.length === frozen.evidence.length && prepared.recovery.evidence.length === 3 && prepared.recovery.selection.choice.id === frozen.candidates[0].id && prepared.deliveryStatus === "NOT_SENT");
  check("상담 자료에서도 누락·근거·FINAL 원본 유지", prepared.review.metrics.missing === frozen.metrics.missing && prepared.review.finalHash === frozen.finalHash && JSON.stringify(prepared.review.features) === JSON.stringify(frozen.features));
  const consultationPage = await fetch(`${origin}/consultation/${interviewId}`, { headers: { cookie }, redirect: "manual" });
  check("금융기관 상담 준비 화면 접근", consultationPage.status === 200 && (await consultationPage.text()).includes("금융기관 상담 준비"));
  const reloaded = await api(`${base}/data-review`, undefined, "DataReviewSuccessEnvelope");
  check("새 Evidence와 검토 후 FINAL hash/Feature 불변", frozen.finalHash === reloaded.finalHash && JSON.stringify(frozen.features) === JSON.stringify(reloaded.features));
  const list = await api("/api/data-reviews", undefined, "DataReviewListSuccessEnvelope");
  check("담당자 목록: Coverage / Action / Review 연결", list.items.some((item) => item.id === interviewId && item.metrics.computed === frozen.metrics.computed && item.planSelected === "SELECTED" && item.reviewStatus === "NEEDS_INFORMATION"));
  return { interviewId, checks, providers, metrics: frozen.metrics, finalHash: frozen.finalHash, newEvidence: recovery.evidence.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = process.argv.indexOf("--origin");
  const origin = argument >= 0 ? process.argv[argument + 1] : null;
  assert(origin && new URL(origin).protocol === "https:", "공개 합성 데모 주소를 --origin https://... 형식으로 지정하세요.");
  const session = await requestEngine(origin, "/api/auth/visitor-session", { method: "POST", mutationOrigin: origin, body: {} });
  assert(session.response.ok, `공개 체험 세션 실패: ${session.response.status}`);
  const cookie = session.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, "공개 체험 세션 쿠키가 없습니다.");
  const result = await verifyDataEngine({ origin, cookie });
  const other = await requestEngine(origin, "/api/auth/visitor-session", { method: "POST", mutationOrigin: origin, body: {} });
  assert(other.response.ok, "두 번째 방문자 세션 생성 실패");
  const otherCookie = other.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(otherCookie, "두 번째 방문자 세션 쿠키가 없습니다.");
  for (const suffix of ["data-review", "recovery", "consultation-package"]) {
    const isolated = await requestEngine(origin, `/api/interviews/${result.interviewId}/${suffix}`, { cookie: otherCookie });
    assert(isolated.response.status === 404, `방문자 격리 실패: ${suffix}`);
    result.checks.push(`방문자별 ${suffix} 격리`);
  }
  process.stdout.write(`${JSON.stringify({ origin, ...result }, null, 2)}\n`);
}
