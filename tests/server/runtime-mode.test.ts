import { describe, expect, it } from "vitest";

import { applyCustomServerRuntimeMode } from "../../src/server/runtime-mode";

describe("custom server runtime mode", () => {
  it("forces production protections when npm start did not provide NODE_ENV", () => {
    const environment: Record<string, string | undefined> = {};

    expect(applyCustomServerRuntimeMode(false, environment)).toBe("production");
    expect(environment.NODE_ENV).toBe("production");
  });

  it("forces development mode only for the explicit --dev path", () => {
    const environment: Record<string, string | undefined> = {};

    expect(applyCustomServerRuntimeMode(true, environment)).toBe("development");
    expect(environment.NODE_ENV).toBe("development");
  });

  it.each([
    { development: false, configured: "development" },
    { development: true, configured: "production" },
  ])(
    "rejects contradictory mode $configured for --dev=$development",
    ({ development, configured }) => {
      expect(() =>
        applyCustomServerRuntimeMode(development, { NODE_ENV: configured }),
      ).toThrow(/mode conflict/i);
    },
  );
});
