import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService, LOCAL_WORKSPACE_EMAIL, LOCAL_WORKSPACE_TENANT_ID, SESSION_COOKIE_NAME } from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import {
  IAP_ASSERTION_HEADER, IAP_PUBLIC_KEYS_URL, initializeIapVerifier,
  isGoogleIapMode, readIapConfiguration, stopIapVerifier, verifyIapRequest,
} from "../../src/server/iap-auth";
import {
  assertApplicationAuthenticationAvailable, assertCustomServerAuthenticationConfigured,
  isExactProductionE2ELocalAuthGate, type AuthenticationRuntimeEnvironment,
} from "../../src/server/production-auth-policy";

const environment: AuthenticationRuntimeEnvironment = {
  NODE_ENV: "production",
  DONGHAENG_AUTH_MODE: "google-iap",
  DONGHAENG_IAP_AUDIENCE: "/projects/123456789/locations/asia-northeast3/services/donghaeng-finance-ai",
  DONGHAENG_IAP_ALLOWED_EMAILS: "owner@example.com",
  DONGHAENG_IAP_TENANT_ID: "donghaeng-owner",
  DONGHAENG_APP_ORIGIN: "https://finance.example.com",
};
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const alternate = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "iap-key-1", alg: "ES256", use: "sig" };
const fixedNow = new Date("2026-09-04T03:00:00.000Z");
const nowSeconds = fixedNow.getTime() / 1_000;
const databases: DatabaseSync[] = [];

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://cloud.google.com/iap", aud: environment.DONGHAENG_IAP_AUDIENCE,
    sub: "accounts.google.com:1234567890", email: "owner@example.com",
    iat: nowSeconds - 5, exp: nowSeconds + 595, ...overrides,
  };
}

function signedToken(
  payload = claims(),
  header: Record<string, unknown> = { alg: "ES256", kid: "iap-key-1", typ: "JWT" },
  signingKey: KeyObject = privateKey,
): string {
  const body = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign("sha256", Buffer.from(body), { key: signingKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function request(token = signedToken(), headers: Record<string, string> = {}): Request {
  return new Request("https://finance.example.com/api/auth/me", {
    headers: { [IAP_ASSERTION_HEADER]: token, ...headers },
  });
}

function keyResponse(body: unknown = { keys: [publicJwk] }, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600", ...headers },
  });
}

async function initialize(fetcher: typeof fetch = vi.fn(async () => keyResponse())): Promise<typeof fetch> {
  await initializeIapVerifier({ environment, fetcher, autoRefresh: false });
  return fetcher;
}

function auth(): AuthService {
  const database = createInMemoryDatabase();
  databases.push(database);
  return new AuthService(database, () => new Date(), environment);
}

beforeEach(() => {
  stopIapVerifier();
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
});

afterEach(() => {
  stopIapVerifier();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  while (databases.length > 0) databases.pop()?.close();
});

describe("Google IAP deployment configuration", () => {
  it("accepts explicit audience, exact HTTPS origin, allowlist and non-local tenant", () => {
    expect(isGoogleIapMode(environment)).toBe(true);
    expect(readIapConfiguration(environment)).toMatchObject({
      audience: environment.DONGHAENG_IAP_AUDIENCE, tenantId: "donghaeng-owner",
      appOrigin: "https://finance.example.com", allowedEmails: new Set(["owner@example.com"]),
    });
    expect(() => assertCustomServerAuthenticationConfigured({
      development: false, hostname: "0.0.0.0", port: 8080, environment,
    })).not.toThrow();
    expect(() => assertApplicationAuthenticationAvailable(environment)).not.toThrow();
    expect(isExactProductionE2ELocalAuthGate(environment)).toBe(false);
  });

  it.each([
    ["DONGHAENG_AUTH_MODE", "google"],
    ["DONGHAENG_IAP_AUDIENCE", ""],
    ["DONGHAENG_IAP_AUDIENCE", "https://finance.example.com"],
    ["DONGHAENG_IAP_AUDIENCE", "/projects/123456789/locations/*/services/*"],
    ["DONGHAENG_IAP_ALLOWED_EMAILS", ""],
    ["DONGHAENG_IAP_ALLOWED_EMAILS", "*@example.com"],
    ["DONGHAENG_IAP_ALLOWED_EMAILS", "owner@example.com,"],
    ["DONGHAENG_IAP_TENANT_ID", ""],
    ["DONGHAENG_IAP_TENANT_ID", "local-workspace-tenant"],
    ["DONGHAENG_IAP_TENANT_ID", "../tenant"],
    ["DONGHAENG_APP_ORIGIN", "http://finance.example.com"],
    ["DONGHAENG_APP_ORIGIN", "https://finance.example.com/"],
    ["DONGHAENG_APP_ORIGIN", "https://user:pass@finance.example.com"],
    ["DONGHAENG_APP_ORIGIN", "https://finance.example.com/path"],
    ["DONGHAENG_E2E_AUTH_ALLOW_LOCAL", "1"],
  ])("rejects malformed configuration %s=%s", (name, value) => {
    const invalid = { ...environment, [name]: value };
    expect(() => readIapConfiguration(invalid)).toThrowError(expect.objectContaining({ status: 503 }));
    expect(() => assertApplicationAuthenticationAvailable(invalid)).toThrowError(expect.objectContaining({ status: 503 }));
    expect(() => assertCustomServerAuthenticationConfigured({
      development: false, hostname: "0.0.0.0", port: 8080, environment: invalid,
    })).toThrow();
  });

  it("keeps absent production IdP fail-closed", () => {
    expect(() => assertApplicationAuthenticationAvailable({ NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_IDP_NOT_CONFIGURED" }),
    );
  });
});

describe("Google signed IAP assertion verification", () => {
  it("verifies ES256 IEEE-P1363 signature with only the configured audience and email", async () => {
    const fetcher = await initialize();
    expect(verifyIapRequest(request(), environment)).toEqual({
      subject: "accounts.google.com:1234567890", email: "owner@example.com",
      tenantId: "donghaeng-owner", expiresAt: new Date((nowSeconds + 595) * 1_000).toISOString(),
    });
    expect(fetcher).toHaveBeenCalledWith(IAP_PUBLIC_KEYS_URL, expect.objectContaining({ redirect: "error" }));
    verifyIapRequest(request(), environment);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores unsigned email/ID headers and local cookies", async () => {
    await initialize();
    const forged = new Request("https://finance.example.com", { headers: {
      "x-goog-authenticated-user-email": "accounts.google.com:owner@example.com",
      "x-goog-authenticated-user-id": "accounts.google.com:1234567890",
      cookie: `${SESSION_COOKIE_NAME}=pretend-local-session`,
    } });
    expect(() => verifyIapRequest(forged, environment)).toThrowError(
      expect.objectContaining({ status: 401, code: "IAP_ASSERTION_REQUIRED" }),
    );
  });

  it("rejects missing cache and a signature from an untrusted private key", async () => {
    expect(() => verifyIapRequest(request(), environment)).toThrowError(
      expect.objectContaining({ status: 503, code: "IAP_VERIFIER_UNAVAILABLE" }),
    );
    await initialize();
    expect(() => verifyIapRequest(request(signedToken(claims(), undefined, alternate.privateKey)), environment)).toThrowError(
      expect.objectContaining({ code: "IAP_ASSERTION_INVALID" }),
    );
  });

  it.each([
    { iss: "https://accounts.google.com" }, { aud: "other-audience" },
    { aud: [environment.DONGHAENG_IAP_AUDIENCE] }, { iss: undefined }, { aud: undefined },
    { sub: undefined }, { sub: "" }, { sub: "other-issuer:1234567890" },
    { email: undefined }, { email: " owner@example.com" }, { email: "not-an-email" },
    { email_verified: false }, { iat: undefined }, { exp: undefined },
    { iat: String(nowSeconds - 5) }, { exp: String(nowSeconds + 595) },
    { iat: nowSeconds + 31 }, { iat: nowSeconds - 700, exp: nowSeconds - 60 },
    { exp: nowSeconds + 1_000 }, { iat: nowSeconds + 5, exp: nowSeconds + 5 },
    { nbf: nowSeconds + 31 }, { nbf: "tomorrow" },
  ])("rejects invalid or absent claims: %j", async (overrides) => {
    await initialize();
    expect(() => verifyIapRequest(request(signedToken(claims(overrides))), environment)).toThrowError(
      expect.objectContaining({ status: 401, code: "IAP_ASSERTION_INVALID" }),
    );
  });

  it.each([
    { alg: "none" }, { alg: "HS256" }, { kid: "missing-key" }, { kid: undefined },
    { kid: "../../key" }, { jku: "https://attacker.example/jwks" },
    { jwk: publicJwk }, { x5u: "https://attacker.example/cert" },
    { crit: ["b64"] }, { b64: false },
  ])("rejects unsafe JWT header: %j", async (override) => {
    await initialize();
    expect(() => verifyIapRequest(request(signedToken(claims(), {
      alg: "ES256", kid: "iap-key-1", ...override,
    })), environment)).toThrowError(expect.objectContaining({ code: "IAP_ASSERTION_INVALID" }));
  });

  it.each(["not-a-jwt", "a.b.c", "x".repeat(16_385)])("rejects malformed or oversized JWT", async (token) => {
    await initialize();
    expect(() => verifyIapRequest(request(token), environment)).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("does not let unsigned headers replace the signed, unapproved email", async () => {
    await initialize();
    expect(() => verifyIapRequest(request(signedToken(claims({ email: "intruder@example.com" })), {
      "x-goog-authenticated-user-email": "accounts.google.com:owner@example.com",
    }), environment)).toThrowError(expect.objectContaining({ status: 403, code: "IAP_ACCOUNT_NOT_ALLOWED" }));
  });

  it("allows Google's bounded clock skew and normalizes case only for email matching", async () => {
    await initialize();
    expect(verifyIapRequest(request(signedToken(claims({
      iat: nowSeconds + 25, exp: nowSeconds + 625, email: "OWNER@EXAMPLE.COM",
    }))), environment).email).toBe("owner@example.com");
  });

  it("shares public keys with a separately imported Next bundle", async () => {
    await initialize();
    vi.resetModules();
    const separateBundle = await import("../../src/server/iap-auth");
    expect(separateBundle.verifyIapRequest(request(), environment).tenantId).toBe("donghaeng-owner");
  });
});

describe("bounded IAP public key refresh", () => {
  it.each([
    {}, { keys: [] }, { keys: [publicJwk, publicJwk] },
    { keys: [{ ...publicJwk, crv: "P-384" }] },
    { keys: [{ ...publicJwk, d: "private-key-material" }] },
    { keys: [{ ...publicJwk, x: "invalid" }] },
    { keys: [{ ...publicJwk, alg: "HS256" }] },
  ])("fails startup on an invalid JWKS: %j", async (body) => {
    await expect(initialize(vi.fn(async () => keyResponse(body)))).rejects.toMatchObject({ code: "IAP_VERIFIER_UNAVAILABLE" });
    expect(() => verifyIapRequest(request(), environment)).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it("bounds response bytes even without Content-Length", async () => {
    await expect(initialize(vi.fn(async () => new Response(" ".repeat(64 * 1_024 + 1))))).rejects.toMatchObject({ code: "IAP_VERIFIER_UNAVAILABLE" });
  });

  it("rejects an oversized Content-Length before reading", async () => {
    await expect(initialize(vi.fn(async () => keyResponse(undefined, {
      "content-length": String(64 * 1_024 + 1),
    })))).rejects.toMatchObject({ code: "IAP_VERIFIER_UNAVAILABLE" });
  });

  it("fails startup if the official key endpoint fails", async () => {
    await expect(initialize(vi.fn(async () => new Response("unavailable", { status: 503 })))).rejects.toMatchObject({ code: "IAP_VERIFIER_UNAVAILABLE" });
  });

  it("aborts a stalled key fetch within five seconds", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const pending = initialize(fetcher);
    const rejected = expect(pending).rejects.toMatchObject({ code: "IAP_VERIFIER_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(5_001);
    await rejected;
  });

  it("does not extend last-good keys after refresh failures or beyond the one-hour cap", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(keyResponse()).mockRejectedValue(new Error("offline"));
    await initialize(fetcher);
    vi.setSystemTime(new Date(fixedNow.getTime() + 5 * 60_000));
    const current = Math.floor(Date.now() / 1_000);
    expect(verifyIapRequest(request(signedToken(claims({ iat: current - 5, exp: current + 595 }))), environment).email).toBe("owner@example.com");
    await Promise.resolve();
    vi.setSystemTime(new Date(fixedNow.getTime() + 60 * 60_000 + 1));
    expect(() => verifyIapRequest(request(), environment)).toThrowError(expect.objectContaining({ code: "IAP_VERIFIER_UNAVAILABLE" }));
  });

  it("honors key cache max-age and Age rather than extending stale HTTP cache entries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(keyResponse(undefined, {
      "cache-control": "public, max-age=120", age: "60",
    })).mockRejectedValue(new Error("offline"));
    await initialize(fetcher);
    vi.setSystemTime(new Date(fixedNow.getTime() + 60_001));
    expect(() => verifyIapRequest(request(), environment)).toThrowError(expect.objectContaining({ code: "IAP_VERIFIER_UNAVAILABLE" }));
  });

  it("refreshes on a bounded schedule and handles signing key rotation", async () => {
    const rotatedJwk = { ...alternate.publicKey.export({ format: "jwk" }), kid: "iap-key-2", alg: "ES256", use: "sig" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(keyResponse()).mockImplementation(async () => keyResponse({ keys: [rotatedJwk] }));
    await initializeIapVerifier({ environment, fetcher });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const current = Math.floor(Date.now() / 1_000);
    expect(verifyIapRequest(request(signedToken(claims({ iat: current - 5, exp: current + 595 }), {
      alg: "ES256", kid: "iap-key-2",
    }, alternate.privateKey)), environment).email).toBe("owner@example.com");
    expect(() => verifyIapRequest(request(), environment)).toThrowError(expect.objectContaining({ status: 401 }));
  });
});

describe("IAP principal persistence and local-auth isolation", () => {
  it("creates only the configured tenant and stable subject-bound ADMIN/INTERVIEWER user", async () => {
    await initialize();
    const service = auth();
    const first = service.authenticate(request());
    const second = service.authenticate(request());
    expect(first).toEqual(second);
    expect(first).toMatchObject({ tenantId: "donghaeng-owner", roles: ["ADMIN", "INTERVIEWER"] });
    expect(first.tenantId).not.toBe(LOCAL_WORKSPACE_TENANT_ID);
    const users = service.database.prepare("SELECT id, email, password_hash FROM users WHERE tenant_id = ?").all("donghaeng-owner");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: first.userId, email: "owner@example.com", password_hash: "UNINITIALIZED" });
    expect(service.database.prepare("SELECT count(*) AS count FROM auth_sessions WHERE tenant_id = ?").get("donghaeng-owner")?.count).toBe(0);
    expect(service.getSession(request())).toEqual({
      principal: first, expiresAt: new Date((nowSeconds + 595) * 1_000).toISOString(),
      authMode: "google-iap", logoutSupported: false,
    });
  });

  it("ignores requested tenant/roles and does not grant roles from token claims", async () => {
    await initialize();
    const principal = auth().authenticate(request(signedToken(claims({ tenantId: "victim", roles: ["SUPERUSER"] })), {
      "x-tenant-id": "victim",
    }));
    expect(principal.tenantId).toBe("donghaeng-owner");
    expect(principal.roles).toEqual(["ADMIN", "INTERVIEWER"]);
  });

  it("does not provision an unapproved email or invalid token", async () => {
    await initialize();
    const service = auth();
    expect(() => service.authenticate(request(signedToken(claims({ email: "intruder@example.com" }))))).toThrow();
    expect(service.database.prepare("SELECT id FROM tenants WHERE id = ?").get("donghaeng-owner")).toBeUndefined();
  });

  it("respects a disabled account and forbids another subject taking over its email", async () => {
    await initialize();
    const service = auth();
    const principal = service.authenticate(request());
    expect(() => service.authenticate(request(signedToken(claims({ sub: "accounts.google.com:999999999" }))))).toThrowError(
      expect.objectContaining({ code: "IAP_ACCOUNT_DISABLED" }),
    );
    service.database.prepare("UPDATE users SET active = 0 WHERE id = ?").run(principal.userId);
    expect(() => service.authenticate(request())).toThrowError(expect.objectContaining({ status: 403, code: "IAP_ACCOUNT_DISABLED" }));
  });

  it("rejects bootstrap, password login and pre-existing local cookies in IAP mode", async () => {
    await initialize();
    const service = auth();
    const local = new AuthService(service.database, () => new Date(), {
      NODE_ENV: "development", DONGHAENG_LOCAL_PASSWORD: "test-password-only",
    }).bootstrapLocalWorkspace();
    const localRequest = new Request("https://finance.example.com", { headers: {
      cookie: `${SESSION_COOKIE_NAME}=${local.token}`,
    } });
    expect(() => service.authenticate(localRequest)).toThrowError(expect.objectContaining({ code: "IAP_ASSERTION_REQUIRED" }));
    expect(() => service.login(LOCAL_WORKSPACE_EMAIL, "test-password-only")).toThrowError(expect.objectContaining({ code: "PASSWORD_LOGIN_DISABLED" }));
    expect(() => service.bootstrapLocalWorkspace()).toThrowError(expect.objectContaining({ code: "LOCAL_BOOTSTRAP_DISABLED" }));
    expect(() => service.logout(request())).toThrowError(expect.objectContaining({ code: "IAP_LOGOUT_EXTERNAL_REQUIRED", status: 409 }));
  });
});
