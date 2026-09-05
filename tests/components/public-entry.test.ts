import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import BorrowerPage from "../../src/app/borrower/page";
import { BorrowerInterviewStart } from "../../src/components/borrower-interview-start";

afterEach(() => vi.unstubAllEnvs());

describe("public interview entry and consent boundary", () => {
  it("lets a guest skip identity fields but still requires unselected consent before a real interview", () => {
    const html = renderToStaticMarkup(createElement(BorrowerInterviewStart, { publicReview: true, sampleEntry: true }));
    expect(html).toContain("체험용 가상 카페");
    expect(html).toContain("채팅으로 답변");
    expect(html).not.toContain('autoComplete="name"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("사업 수치와 인터뷰 답변은 채우지 않았습니다");
  });

  it("does not let a sample query prefill the protected owner service", async () => {
    vi.stubEnv("DONGHAENG_AUTH_MODE", "google-iap");
    const page = await BorrowerPage({ searchParams: Promise.resolve({ entry: "sample" }) });
    expect(page.props.publicReview).toBe(false);
    expect(page.props.sampleEntry).toBe(false);
    const html = renderToStaticMarkup(page);
    expect(html).not.toContain("체험용 가상 카페");
    expect(html).toContain("인터뷰 시작");
  });

  it("prefills only when the public visitor explicitly follows the sample entry", async () => {
    vi.stubEnv("DONGHAENG_AUTH_MODE", "public-review");
    const ownPage = await BorrowerPage({ searchParams: Promise.resolve({}) });
    expect(ownPage.props.sampleEntry).toBe(false);
    const samplePage = await BorrowerPage({ searchParams: Promise.resolve({ entry: "sample" }) });
    expect(samplePage.props.sampleEntry).toBe(true);
  });
});
