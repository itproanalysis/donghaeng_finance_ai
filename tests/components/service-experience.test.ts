import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("one real service with role-specific alley journeys", () => {
  it("requires current borrower confirmation before either completion mode", () => {
    const workspace = source("components/interview-workspace.tsx");
    expect(workspace).toContain("두 종료 방식 모두 확인이 필요합니다");
    expect(workspace).toContain('disabled={!borrowerConfirmationCurrent || forceReason.trim().length < 3 || isCompleting}');
    expect(workspace).toContain('borrowerConfirmed: borrowerConfirmationCurrent');
  });
  it.each([
    ["app/page.tsx", "ServiceOverview"],
    ["app/borrower/page.tsx", "BorrowerInterviewStart"],
    ["app/borrower/interviews/[id]/page.tsx", "BorrowerInterviewRoom"],
    ["app/interviews/page.tsx", "AdminOperationsBoard"],
    ["app/interviews/[id]/page.tsx", "InterviewWorkspace"],
    ["app/interview-evaluations/page.tsx", "EvaluationList"],
    ["app/interview-evaluations/[id]/page.tsx", "EvaluationReport"],
  ])("keeps %s connected to %s rather than a static interview", (route, component) => {
    expect(source(route)).toContain(component);
    expect(source(route)).not.toMatch(/AlleyDialogueInterview|AlleyAdminDesk|AlleyRoadHome/);
  });
  it("passes record identifiers and voice selection through the actual detail route", () => {
    const borrower = source("app/borrower/interviews/[id]/page.tsx");
    expect(borrower).toContain("await Promise.all([params, searchParams])");
    expect(borrower).toContain("interviewId={id}");
    expect(borrower).toContain("autoplay");
  });
  it("keeps fixture code off public entries and redirects older demo links", () => {
    for (const path of ["components/service-overview.tsx", "components/borrower-interview-start.tsx", "components/login-form.tsx"]) {
      expect(source(path)).not.toContain('href="/demo');
      expect(source(path)).not.toContain("local-demo@donghaeng.ai");
    }
    expect(source("app/demo/page.tsx")).toContain('redirect("/")');
    expect(source("app/demo/borrower/page.tsx")).toContain('redirect("/borrower")');
    expect(source("app/demo/admin/page.tsx")).toContain('redirect("/interviews")');
  });
  it("requires explicit industry choice and displays actual operational next actions", () => {
    expect(source("components/start-interview-button.tsx")).toContain('useState<SohoIndustryCode | "">("")');
    const board = source("components/admin-operations-board.tsx");
    expect(board).toContain("/api/interviews?"); expect(board).toContain("interviewNextAction(item)");
    expect(board).toContain("controller.abort()"); expect(board).toContain("result.summary[filter.count]");
    expect(board).not.toContain("CASES_DATA");
  });
  it("shows one voice conversation and station progress without a financial-looking radar score", () => {
    const room = source("components/borrower-interview-room.tsx");
    expect(room).toContain("borrower-business-route");
    expect(room).not.toContain("<polygon");
    expect(room).toContain('if (method === "voice" && !realtimeVoiceFallback) return;');
    expect(room).toContain('{method === "chat" && <>');
    expect(room).toContain("현재 단계");
    expect(room).not.toContain("localStorage");
    expect(room).toContain('useState<"answers" | "business">("answers")');
    expect(room).toContain('aria-label="내 이야기 살펴보기"');
  });
  it("persists consultation drafts separately, showing failures instead of fake saved status", () => {
    expect(source("components/evaluation-report.tsx")).toContain("interviewId={evaluation.interviewId}");
    const workbench = source("components/consultation-workbench.tsx");
    expect(workbench).toContain("초안 저장"); expect(workbench).not.toContain("새로고침하면 선택 내용은 초기화");
    const hook = source("components/use-consultation-draft.ts");
    expect(hook).toContain("expectedRevision: revision"); expect(hook).toContain("beforeunload");
    expect(hook).not.toContain("localStorage");
  });
  it("keeps connection diagnostics collapsed and supplies reduced-motion styling", () => {
    expect(source("components/interview-workspace.tsx")).toContain('<details className="service-diagnostics">');
    expect(source("app/service-experience.css")).toContain("prefers-reduced-motion: reduce");
    expect(source("app/layout.tsx")).toContain("<AppHeader");
  });
  it("does not send half-composed Korean input on Enter", () => {
    for (const path of ["components/borrower-interview-room.tsx", "components/interview-workspace.tsx"]) {
      expect(source(path)).toContain("!event.nativeEvent.isComposing");
    }
  });
});
