import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthService,
  LOCAL_WORKSPACE_EMAIL,
  SESSION_COOKIE_NAME,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import {
  assertApplicationAuthenticationAvailable,
  assertCustomServerAuthenticationConfigured,
  isExactProductionE2ELocalAuthGate,
  type AuthenticationRuntimeEnvironment,
} from "../../src/server/production-auth-policy";
import { getAuthService } from "../../src/server/service-instance";

const databases: DatabaseSync[] = [];
const exactEnvironment: AuthenticationRuntimeEnvironment = {
  NODE_ENV: "production",
  DONGHAENG_E2E_AUTH_ALLOW_LOCAL: "1",
  DONGHAENG_HOST: "127.0.0.1",
  DONGHAENG_PORT: "45123",
  DONGHAENG_APP_ORIGIN: "http://127.0.0.1:45123",
};
const invalidGates: Array<[AuthenticationRuntimeEnvironment, string]> = [
  [{ ...exactEnvironment, DONGHAENG_E2E_AUTH_ALLOW_LOCAL: undefined }, "missing flag"],
  [{ ...exactEnvironment, DONGHAENG_E2E_AUTH_ALLOW_LOCAL: "true" }, "wrong flag"],
  [{ ...exactEnvironment, DONGHAENG_HOST: "0.0.0.0" }, "public bind"],
  [{ ...exactEnvironment, DONGHAENG_APP_ORIGIN: "https://example.com" }, "public origin"],
  [{ ...exactEnvironment, DONGHAENG_APP_ORIGIN: "http://127.0.0.1:45123/path" }, "origin path"],
  [{ ...exactEnvironment, DONGHAENG_APP_ORIGIN: "http://127.0.0.1:45124" }, "port mismatch"],
  [{ ...exactEnvironment, DONGHAENG_PORT: undefined }, "missing port"],
];

function clearCustomServerAttestation(): void {
  try {
    assertCustomServerAuthenticationConfigured({
      development: false,
      hostname: "0.0.0.0",
      port: 1,
      environment: { NODE_ENV: "production" },
    });
  } catch {
    // The expected startup failure also clears the process-local attestation.
  }
}

afterEach(() => {
  clearCustomServerAttestation();
  vi.unstubAllEnvs();
  while (databases.length > 0) databases.pop()?.close();
});

describe("production authentication fail-closed policy", () => {
  it("blocks npm-start production configuration before Next setup or port binding", () => {
    expect(() =>
      assertCustomServerAuthenticationConfigured({
        development: false,
        hostname: "127.0.0.1",
        port: 3000,
        environment: { NODE_ENV: "production" },
      }),
    ).toThrow(/external identity provider is not configured/i);

    const source = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
    const guard = source.indexOf("assertCustomServerAuthenticationConfigured({");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf("const application = next("));
    expect(guard).toBeLessThan(source.indexOf("server.listen("));
  });

  it.each(invalidGates)("rejects a partial or malformed E2E gate: %s", (environment) => {
    expect(isExactProductionE2ELocalAuthGate(environment)).toBe(false);
    expect(() => assertApplicationAuthenticationAvailable(environment)).toThrowError(
      expect.objectContaining({
        status: 503,
        code: "PRODUCTION_IDP_NOT_CONFIGURED",
      }),
    );
  });

  it("allows local authentication only for the exact loopback production E2E gate", () => {
    expect(isExactProductionE2ELocalAuthGate(exactEnvironment)).toBe(true);
    // Exact-looking environment variables are insufficient in a direct Next
    // deployment: the custom server must attest its actual bind first.
    expect(() => assertApplicationAuthenticationAvailable(exactEnvironment)).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_IDP_NOT_CONFIGURED" }),
    );
    expect(() =>
      assertCustomServerAuthenticationConfigured({
        development: false,
        hostname: "127.0.0.1",
        port: 45123,
        environment: exactEnvironment,
      }),
    ).not.toThrow();
    expect(() => assertApplicationAuthenticationAvailable(exactEnvironment)).not.toThrow();
    expect(() =>
      assertCustomServerAuthenticationConfigured({
        development: false,
        hostname: "0.0.0.0",
        port: 45123,
        environment: exactEnvironment,
      }),
    ).toThrow();
    expect(() => assertApplicationAuthenticationAvailable(exactEnvironment)).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_IDP_NOT_CONFIGURED" }),
    );
  });

  it("rejects a previously valid local workspace password and session in ordinary production", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const now = () => new Date("2026-08-11T12:00:00.000Z");
    const password = "test-only-local-password";
    const developmentAuth = new AuthService(database, now, {
      NODE_ENV: "development",
      DONGHAENG_LOCAL_PASSWORD: password,
    });
    const session = developmentAuth.bootstrapLocalWorkspace();
    const request = new Request("http://127.0.0.1/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
    });
    const productionAuth = new AuthService(database, now, {
      NODE_ENV: "production",
    });

    expect(() => productionAuth.authenticate(request)).toThrowError(
      expect.objectContaining({
        status: 503,
        code: "PRODUCTION_IDP_NOT_CONFIGURED",
      }),
    );
    expect(() => productionAuth.login(LOCAL_WORKSPACE_EMAIL, password)).toThrowError(
      expect.objectContaining({
        status: 503,
        code: "PRODUCTION_IDP_NOT_CONFIGURED",
      }),
    );

    const e2eAuth = new AuthService(database, now, {
      ...exactEnvironment,
      DONGHAENG_LOCAL_PASSWORD: password,
    });
    assertCustomServerAuthenticationConfigured({
      development: false,
      hostname: "127.0.0.1",
      port: 45123,
      environment: exactEnvironment,
    });
    expect(e2eAuth.authenticate(request).email).toBe(LOCAL_WORKSPACE_EMAIL);
    expect(e2eAuth.login(LOCAL_WORKSPACE_EMAIL, password).principal.email).toBe(
      LOCAL_WORKSPACE_EMAIL,
    );
    expect(() => e2eAuth.bootstrapLocalWorkspace()).toThrowError(
      expect.objectContaining({ code: "LOCAL_BOOTSTRAP_DISABLED" }),
    );
  });

  it("guards the shared Next service entrypoint before opening the database", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DONGHAENG_E2E_AUTH_ALLOW_LOCAL", "");
    vi.stubEnv("DONGHAENG_HOST", "");
    vi.stubEnv("DONGHAENG_PORT", "");
    vi.stubEnv("DONGHAENG_APP_ORIGIN", "");
    expect(() => getAuthService()).toThrowError(expect.objectContaining({
      status: 503,
      code: "PRODUCTION_IDP_NOT_CONFIGURED",
    }));
  });
});
