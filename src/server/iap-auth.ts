import { createPublicKey, verify, type KeyObject } from "node:crypto";

import { ApplicationError } from "./errors";
import type { AuthenticationRuntimeEnvironment } from "./production-auth-policy";

export const IAP_ASSERTION_HEADER = "x-goog-iap-jwt-assertion";
export const IAP_PUBLIC_KEYS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const IAP_ISSUER = "https://cloud.google.com/iap";
const KEY_FETCH_TIMEOUT_MS = 5_000;
const KEY_RESPONSE_LIMIT_BYTES = 64 * 1_024;
const KEY_REFRESH_INTERVAL_MS = 5 * 60_000;
const KEY_MAX_AGE_MS = 60 * 60_000;
const KEY_REFRESH_RETRY_MS = 30_000;
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LIFETIME_SECONDS = 600 + 2 * CLOCK_SKEW_SECONDS;
const KID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;

export interface IapConfiguration {
  audience: string;
  allowedEmails: ReadonlySet<string>;
  tenantId: string;
  appOrigin: string;
}

export interface IapIdentity {
  subject: string;
  email: string;
  tenantId: string;
  expiresAt: string;
}

interface IapKeyCache {
  keys: Map<string, KeyObject>;
  validUntil: number;
  refreshAfter: number;
  lastAttemptAt: number;
  fetcher: typeof fetch;
  inFlight?: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
}

// server.ts and Next's separately bundled route modules must use the same
// verified key material. The cache contains public keys only, never JWTs.
const iapRuntime = globalThis as typeof globalThis & {
  __donghaengIapKeyCache?: IapKeyCache;
};

function configurationError(): ApplicationError {
  return new ApplicationError(
    503,
    "IAP_CONFIGURATION_INVALID",
    "Google 운영 인증 설정이 완전하지 않습니다.",
  );
}

function unavailableKeys(): ApplicationError {
  return new ApplicationError(
    503,
    "IAP_VERIFIER_UNAVAILABLE",
    "Google 인증 확인을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
}

function invalidAssertion(): ApplicationError {
  return new ApplicationError(401, "IAP_ASSERTION_INVALID", "Google 인증을 확인할 수 없습니다.");
}

function normalizeEmail(value: string): string {
  return value.toLowerCase();
}

export function isGoogleIapMode(
  environment: AuthenticationRuntimeEnvironment = process.env,
): boolean {
  return environment.DONGHAENG_AUTH_MODE?.trim() === "google-iap";
}

export function readIapConfiguration(
  environment: AuthenticationRuntimeEnvironment = process.env,
): IapConfiguration {
  if (!isGoogleIapMode(environment)) throw configurationError();
  const audience = environment.DONGHAENG_IAP_AUDIENCE?.trim() ?? "";
  const tenantId = environment.DONGHAENG_IAP_TENANT_ID?.trim() ?? "";
  const appOrigin = environment.DONGHAENG_APP_ORIGIN?.trim() ?? "";
  const emails = (environment.DONGHAENG_IAP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => normalizeEmail(email.trim()));
  let origin: URL;
  try {
    origin = new URL(appOrigin);
  } catch {
    throw configurationError();
  }
  if (
    !/^\/projects\/[0-9]+\/(?:apps\/[a-z][a-z0-9-]*|global\/backendServices\/[0-9]+|locations\/[a-z0-9-]+\/services\/[a-z][a-z0-9-]*)$/.test(audience) ||
    !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(tenantId) ||
    tenantId.startsWith("local-workspace") ||
    emails.length > 100 ||
    emails.some((email) => email.length > 254 || email.includes("*") || !EMAIL_PATTERN.test(email)) ||
    origin.protocol !== "https:" ||
    origin.origin !== appOrigin ||
    environment.DONGHAENG_E2E_AUTH_ALLOW_LOCAL === "1"
  ) {
    throw configurationError();
  }
  return { audience, tenantId, appOrigin, allowedEmails: new Set(emails) };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidAssertion();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw invalidAssertion();
  return decoded;
}

function parseJwtObject(value: string): Record<string, unknown> {
  try {
    const parsed = objectValue(JSON.parse(decodeBase64Url(value).toString("utf8")));
    if (!parsed) throw invalidAssertion();
    return parsed;
  } catch {
    throw invalidAssertion();
  }
}

function parsePublicKeys(value: unknown): Map<string, KeyObject> {
  const body = objectValue(value);
  if (!body || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 32) {
    throw unavailableKeys();
  }
  const keys = new Map<string, KeyObject>();
  for (const entry of body.keys) {
    const key = objectValue(entry);
    if (
      !key || typeof key.kid !== "string" || !KID_PATTERN.test(key.kid) ||
      keys.has(key.kid) || key.kty !== "EC" || key.crv !== "P-256" ||
      (key.alg !== undefined && key.alg !== "ES256") ||
      (key.use !== undefined && key.use !== "sig") || key.d !== undefined ||
      (key.key_ops !== undefined && (
        !Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== "verify"
      )) ||
      typeof key.x !== "string" || typeof key.y !== "string"
    ) {
      throw unavailableKeys();
    }
    if (decodeBase64Url(key.x).length !== 32 || decodeBase64Url(key.y).length !== 32) {
      throw unavailableKeys();
    }
    const publicKey = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: key.x, y: key.y },
    });
    keys.set(key.kid, publicKey);
  }
  return keys;
}

async function fetchPublicKeys(cache: IapKeyCache): Promise<void> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS);
  deadline.unref?.();
  try {
    const response = await cache.fetcher(IAP_PUBLIC_KEYS_URL, {
      signal: controller.signal,
      redirect: "error",
      headers: { accept: "application/json" },
    });
    const length = response.headers.get("content-length");
    if (!response.ok || !response.body ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > KEY_RESPONSE_LIMIT_BYTES))) {
      await response.body?.cancel();
      throw unavailableKeys();
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > KEY_RESPONSE_LIMIT_BYTES) {
          await reader.cancel();
          throw unavailableKeys();
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    const keys = parsePublicKeys(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const advertisedAge = response.headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)(?:\s*(?:,|$))/i);
    const age = response.headers.get("age");
    const ageMs = age && /^\d+$/.test(age) ? Number(age) * 1_000 : 0;
    const lifetimeMs = advertisedAge
      ? Math.min(Number(advertisedAge[1]) * 1_000 - ageMs, KEY_MAX_AGE_MS)
      : KEY_MAX_AGE_MS;
    if (lifetimeMs <= 0 || !Number.isFinite(lifetimeMs)) throw unavailableKeys();
    const now = Date.now();
    // Only swap a complete validated set. A failed refresh cannot extend the
    // last successful keys' one-hour hard expiry or introduce an unknown kid.
    cache.keys = keys;
    cache.validUntil = now + lifetimeMs;
    cache.refreshAfter = now + Math.min(KEY_REFRESH_INTERVAL_MS, lifetimeMs / 2);
  } catch {
    throw unavailableKeys();
  } finally {
    clearTimeout(deadline);
  }
}

function refreshKeys(cache: IapKeyCache): Promise<void> {
  if (cache.inFlight) return cache.inFlight;
  cache.lastAttemptAt = Date.now();
  const inFlight = fetchPublicKeys(cache);
  cache.inFlight = inFlight;
  void inFlight.finally(() => {
    if (cache.inFlight === inFlight) cache.inFlight = undefined;
  }).catch(() => undefined);
  return inFlight;
}

function maybeRefreshKeys(cache: IapKeyCache, force = false): void {
  const now = Date.now();
  if ((force || now >= cache.refreshAfter) && now - cache.lastAttemptAt >= KEY_REFRESH_RETRY_MS) {
    // Verification stays synchronous. An unknown kid is rejected now; a
    // rate-limited refresh prepares verification for the next request.
    void refreshKeys(cache).catch(() => undefined);
  }
}

/** Call and await before listening. The source URL cannot be configured by a client or environment. */
export async function initializeIapVerifier(options: {
  environment?: AuthenticationRuntimeEnvironment;
  fetcher?: typeof fetch;
  autoRefresh?: boolean;
} = {}): Promise<void> {
  readIapConfiguration(options.environment ?? process.env);
  let cache = iapRuntime.__donghaengIapKeyCache;
  if (!cache) {
    cache = {
      keys: new Map(), validUntil: 0, refreshAfter: 0,
      lastAttemptAt: 0, fetcher: options.fetcher ?? fetch,
    };
    iapRuntime.__donghaengIapKeyCache = cache;
  }
  if (cache.keys.size === 0 || Date.now() >= cache.refreshAfter) await refreshKeys(cache);
  if (Date.now() >= cache.validUntil) throw unavailableKeys();
  if (options.autoRefresh !== false && !cache.timer) {
    cache.timer = setInterval(() => maybeRefreshKeys(cache), KEY_REFRESH_RETRY_MS);
    cache.timer.unref?.();
  }
}

/** Graceful shutdown also invalidates the public-key cache. */
export function stopIapVerifier(): void {
  const cache = iapRuntime.__donghaengIapKeyCache;
  if (cache?.timer) clearInterval(cache.timer);
  delete iapRuntime.__donghaengIapKeyCache;
}

/**
 * Google's signed-header requirements:
 * https://cloud.google.com/iap/docs/signed-headers-howto
 * Unsigned identity headers, cookies, and token-supplied URLs are never trusted.
 */
export function verifyIapRequest(
  request: Request,
  environment: AuthenticationRuntimeEnvironment = process.env,
  now: Date = new Date(),
): IapIdentity {
  const configuration = readIapConfiguration(environment);
  const token = request.headers.get(IAP_ASSERTION_HEADER);
  if (!token) {
    throw new ApplicationError(401, "IAP_ASSERTION_REQUIRED", "Google 로그인이 필요합니다.");
  }
  if (token.length > 16_384) throw invalidAssertion();
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0].length > 2_048 || parts[1].length > 12_000) {
    throw invalidAssertion();
  }
  const header = parseJwtObject(parts[0]);
  if (
    header.alg !== "ES256" || typeof header.kid !== "string" ||
    !KID_PATTERN.test(header.kid) ||
    (header.typ !== undefined && header.typ !== "JWT") ||
    header.crit !== undefined || header.b64 !== undefined ||
    header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined
  ) {
    throw invalidAssertion();
  }
  const signature = decodeBase64Url(parts[2]);
  if (signature.length !== 64) throw invalidAssertion();
  const cache = iapRuntime.__donghaengIapKeyCache;
  if (!cache || Date.now() >= cache.validUntil) {
    if (cache) maybeRefreshKeys(cache);
    throw unavailableKeys();
  }
  maybeRefreshKeys(cache);
  const publicKey = cache.keys.get(header.kid);
  if (!publicKey) {
    maybeRefreshKeys(cache, true);
    throw invalidAssertion();
  }
  if (!verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), {
    key: publicKey, dsaEncoding: "ieee-p1363",
  }, signature)) {
    throw invalidAssertion();
  }
  const payload = parseJwtObject(parts[1]);
  const currentSeconds = now.getTime() / 1_000;
  if (
    !Number.isFinite(currentSeconds) || payload.iss !== IAP_ISSUER ||
    payload.aud !== configuration.audience ||
    typeof payload.sub !== "string" ||
    !/^accounts\.google\.com:[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
    typeof payload.email !== "string" || payload.email.length > 254 ||
    !EMAIL_PATTERN.test(payload.email) ||
    (payload.email_verified !== undefined && payload.email_verified !== true) ||
    typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) || payload.iat <= 0 ||
    typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) ||
    payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS ||
    payload.iat > currentSeconds + CLOCK_SKEW_SECONDS ||
    payload.exp <= currentSeconds - CLOCK_SKEW_SECONDS ||
    (payload.nbf !== undefined && (
      typeof payload.nbf !== "number" || !Number.isSafeInteger(payload.nbf) ||
      payload.nbf > currentSeconds + CLOCK_SKEW_SECONDS
    ))
  ) {
    throw invalidAssertion();
  }
  const email = normalizeEmail(payload.email);
  if (!configuration.allowedEmails.has(email)) {
    throw new ApplicationError(403, "IAP_ACCOUNT_NOT_ALLOWED", "이 서비스에 허용된 Google 계정이 아닙니다.");
  }
  return {
    subject: payload.sub, email, tenantId: configuration.tenantId,
    expiresAt: new Date(payload.exp * 1_000).toISOString(),
  };
}
