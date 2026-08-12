import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");

describe("custom server / Next route runtime boundary", () => {
  it("validates provider configuration without sharing service singletons across bundles", () => {
    expect(source).toContain("assertConfiguredInterviewProvider();");
    expect(source).not.toContain("./src/server/service-instance");
    expect(source).not.toMatch(/\bgetInterviewService\s*\(/);
    expect(source).not.toMatch(/\bgetAuthService\s*\(/);
    expect(source).toContain("getCustomServerAuthService().authenticate(");
  });
});
