import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

import { ServiceOverview } from "@/components/service-overview";
import { BorrowerInterviewStart } from "@/components/borrower-interview-start";
import { AppHeader } from "@/components/app-header";

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

describe("alley atmosphere with real service entry points", () => {
  it("renders the original full-scene asset, service introduction and two entry routes", () => {
    const html = renderToStaticMarkup(createElement(ServiceOverview));
    expect(html).toContain("korean-alley-cafe-integrated-8k.webp");
    expect(html).toContain('href="/borrower"');
    expect(html).toContain('href="/interviews"');
    expect(html).toContain('href="/about"');
    expect(html.match(/<a\s/g)).toHaveLength(3);
    expect(html).toContain("내 가게 이야기하기");
    expect(html).toContain("상담 기록 살펴보기");
    expect(html).toContain("금융 상담·평가 보조 서비스");
    expect(html).not.toMatch(/entrance-promise|interviewer-yujin|\/demo/);
  });

  it("keeps the welcome focused on beginning an interview, with no assumed business or avatar", () => {
    const html = renderToStaticMarkup(createElement(BorrowerInterviewStart));
    expect(html).toContain('data-stage="welcome"');
    expect(html).toContain("인터뷰 시작");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("인터뷰 방식 알아보기");
    expect(html).toContain("AI가 묻고 사장님이 답하는 인터뷰");
    expect(html).not.toMatch(/interviewer-yujin|동행 카페|<input/);
  });

  it.each(["/", "/borrower", "/borrower/interviews/actual-id"])("uses restrained branding on %s", (path) => {
    navigation.pathname = path;
    const html = renderToStaticMarkup(createElement(AppHeader));
    expect(html).toContain("동행금융");
    expect(html).not.toMatch(/동행금융AI|AI 동행자|두 갈래 길 안내/);
    if (path === "/") expect(html).toContain("app-header--entrance");
    else {
      expect(html).toContain("app-header--borrower");
      expect(html).toContain("골목 입구로");
      expect(html).toContain('href="/"');
    }
  });

  it("keeps scenery independent from interview, navigation, timers and generated progress", () => {
    const scene = source("components/alley-entrance-scene.tsx");
    expect(scene).toContain("prefers-reduced-motion: reduce");
    expect(scene).toContain("(hover: hover) and (pointer: fine)");
    expect(scene).toContain("cancelAnimationFrame(frame)");
    expect(scene).toContain("event.clientX - bounds.left");
    expect(scene).toContain('removeEventListener("pointermove", move)');
    expect(scene).not.toMatch(/setInterval|setTimeout|router\.push|fetch\(|\/api\/|ScrollTrigger|enter-demo|localStorage/);
  });

  it("preserves stage focus, consent and actual interview creation", () => {
    const start = source("components/borrower-interview-start.tsx");
    expect(start).toContain("target?.focus()");
    expect(start).toContain('tabIndex={-1} id="borrower-profile-title"');
    expect(start).toContain('tabIndex={-1} id="borrower-method-title"');
    expect(start).toContain('authenticatedFetch("/api/interviews"');
    expect(start).toContain('recordConsent(interviewId, "CLOUD_AI_PROCESSING"');
    expect(start).toContain('recordConsent(interviewId, "MICROPHONE_INTERVIEW"');
    expect(start).toContain("unlockQuestionVoicePlayback()");
  });

  it("retains sound controls and makes technical provider details available without foregrounding them", () => {
    const voice = source("components/realtime-voice-interview.tsx");
    expect(voice).toContain('<strong>음성 인터뷰</strong>');
    expect(voice).toContain('<details className="realtime-voice-call__connection-info">');
    expect(voice).toContain("providerLabel ??");
    expect(voice).toContain("onClick={toggleMute}");
    expect(voice).toContain("onClick={replayQuestion}");
    expect(voice).toContain("onClick={() => closeRealtime()}");
  });

  it("supplies full-height scenery, mobile return navigation and reduced-motion styles", () => {
    const css = source("app/alley-atmosphere.css");
    expect(css).toContain("100svh");
    expect(css).toContain(".app-header--borrower .app-header__admin-link { display: inline-flex;");
    expect(css).toContain(".service-entrance .entrance-path:focus-visible");
    expect(css).toContain("(max-height: 740px)");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(source("app/layout.tsx")).toContain('import "./alley-atmosphere.css"');
  });
});
