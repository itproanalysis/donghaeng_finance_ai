import { afterEach, describe, expect, it } from "vitest";

import { assertSameOriginMutation } from "../../src/server/auth";

const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalAppOrigin = mutableEnvironment.DONGHAENG_APP_ORIGIN;
const originalNodeEnv = mutableEnvironment.NODE_ENV;

afterEach(() => {
  if (originalAppOrigin === undefined) delete mutableEnvironment.DONGHAENG_APP_ORIGIN;
  else mutableEnvironment.DONGHAENG_APP_ORIGIN = originalAppOrigin;
  if (originalNodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
  else mutableEnvironment.NODE_ENV = originalNodeEnv;
});

function mutation(origin: string | null, host = "127.0.0.1:3000"): Request {
  return new Request("http://localhost:3000/api/interviews", {
    method: "POST",
    headers: {
      host,
      ...(origin ? { origin } : {}),
    },
  });
}

describe("same-origin mutation boundary", () => {
  it("uses the original Host when framework request URLs are normalized", () => {
    delete mutableEnvironment.DONGHAENG_APP_ORIGIN;
    expect(() =>
      assertSameOriginMutation(mutation("http://127.0.0.1:3000")),
    ).not.toThrow();
    expect(() =>
      assertSameOriginMutation(mutation("http://attacker.invalid")),
    ).toThrow(expect.objectContaining({ code: "CSRF_REJECTED" }));
  });

  it("keeps an explicitly configured origin authoritative", () => {
    mutableEnvironment.DONGHAENG_APP_ORIGIN = "https://approved.example";
    expect(() =>
      assertSameOriginMutation(mutation("https://approved.example")),
    ).not.toThrow();
    expect(() =>
      assertSameOriginMutation(mutation("http://127.0.0.1:3000")),
    ).toThrow(expect.objectContaining({ code: "CSRF_REJECTED" }));
  });

  it("requires Origin for production mutations", () => {
    mutableEnvironment.NODE_ENV = "production";
    expect(() => assertSameOriginMutation(mutation(null))).toThrow(
      expect.objectContaining({ code: "CSRF_ORIGIN_REQUIRED" }),
    );
  });
});
