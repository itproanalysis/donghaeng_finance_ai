import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headerSource = readFileSync(
  new URL("../../src/components/app-header.tsx", import.meta.url),
  "utf8",
);
const indexPageSource = readFileSync(
  new URL("../../src/app/interviews/page.tsx", import.meta.url),
  "utf8",
);
const startButtonSource = readFileSync(
  new URL("../../src/components/start-interview-button.tsx", import.meta.url),
  "utf8",
);

describe("AI interview entry navigation", () => {
  it("keeps the header link as navigation and creates no interview from the menu", () => {
    expect(headerSource).toContain('href: "/interviews"');
    expect(headerSource).not.toContain('authenticatedFetch("/api/interviews"');
    expect(headerSource).not.toContain("handleLaunchInterview");
  });

  it("requires explicit target details and opens the administrator workspace", () => {
    expect(indexPageSource).toContain("<StartInterviewButton />");
    expect(indexPageSource).not.toContain("autoStart");
    expect(startButtonSource).toContain("onClick={startInterview}");
    expect(startButtonSource).not.toContain("useEffect");
    expect(startButtonSource).not.toContain("autoStart");
    expect(startButtonSource).toContain("사장님 성함 또는 호칭");
    expect(startButtonSource).toContain("사업체 이름");
    expect(startButtonSource).toContain('router.push(`/interviews/${encodeURIComponent(interviewId)}`)');
    expect(startButtonSource).not.toContain("?presentation=1");
  });
});
