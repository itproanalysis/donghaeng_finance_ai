import { ApplicationError } from "./errors";
import { isGoogleIapMode, readIapConfiguration } from "./iap-auth";
import { assertPublicReviewConfiguration, isPublicReviewMode } from "./public-review";

export type AuthenticationRuntimeEnvironment = Record<string, string | undefined>;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const authenticationRuntime = globalThis as typeof globalThis & {
  __donghaengProductionE2EAuthAttestation?: string;
};

function normalizedLoopbackAddress(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return LOOPBACK_ADDRESSES.has(normalized) ? normalized : null;
}

function configuredPort(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]{0,4}$/.test(normalized)) return null;
  const port = Number(normalized);
  return Number.isSafeInteger(port) && port <= 65_535 ? port : null;
}

function loopbackOrigin(
  value: string | undefined,
): { address: string; port: number } | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return null;
  }
  const address = normalizedLoopbackAddress(
    origin.hostname.startsWith("[") && origin.hostname.endsWith("]")
      ? origin.hostname.slice(1, -1)
      : origin.hostname,
  );
  const port = configuredPort(origin.port);
  if (
    origin.protocol !== "http:" ||
    !address ||
    port === null ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    return null;
  }
  return { address, port };
}

function exactGateFingerprint(
  environment: AuthenticationRuntimeEnvironment,
): string | null {
  if (!isExactProductionE2ELocalAuthGate(environment)) return null;
  return [
    normalizedLoopbackAddress(environment.DONGHAENG_HOST),
    configuredPort(environment.DONGHAENG_PORT),
    environment.DONGHAENG_APP_ORIGIN?.trim(),
  ].join("|");
}

/**
 * The only production exception while an external IdP is unimplemented is a
 * deliberately narrow, loopback-only E2E harness. It is not a deployment
 * switch: all four settings must agree exactly.
 */
export function isExactProductionE2ELocalAuthGate(
  environment: AuthenticationRuntimeEnvironment = process.env,
): boolean {
  if (environment.DONGHAENG_AUTH_MODE?.trim()) return false;
  if (environment.NODE_ENV?.trim().toLowerCase() !== "production") return false;
  if (environment.DONGHAENG_E2E_AUTH_ALLOW_LOCAL !== "1") return false;
  const bindAddress = normalizedLoopbackAddress(environment.DONGHAENG_HOST);
  const bindPort = configuredPort(environment.DONGHAENG_PORT);
  const origin = loopbackOrigin(environment.DONGHAENG_APP_ORIGIN);
  return Boolean(
    bindAddress &&
    bindPort !== null &&
    origin &&
    origin.address === bindAddress &&
    origin.port === bindPort,
  );
}

export function assertCustomServerAuthenticationConfigured(input: {
  development: boolean;
  hostname: string;
  port: number;
  environment?: AuthenticationRuntimeEnvironment;
}): void {
  // This process-local attestation is deliberately created only by the custom
  // server after checking its actual bind arguments. Environment variables by
  // themselves must not turn a direct Next deployment into an E2E server.
  delete authenticationRuntime.__donghaengProductionE2EAuthAttestation;
  const environment = input.environment ?? process.env;
  if (isPublicReviewMode(environment)) {
    assertPublicReviewConfiguration(environment);
    return;
  }
  if (isGoogleIapMode(environment)) {
    readIapConfiguration(environment);
    return;
  }
  if (input.development && !environment.DONGHAENG_AUTH_MODE?.trim()) return;
  const fingerprint = exactGateFingerprint(environment);
  if (
    fingerprint &&
    normalizedLoopbackAddress(input.hostname) ===
      normalizedLoopbackAddress(environment.DONGHAENG_HOST) &&
    input.port === configuredPort(environment.DONGHAENG_PORT)
  ) {
    authenticationRuntime.__donghaengProductionE2EAuthAttestation = fingerprint;
    return;
  }
  throw new Error(
    "Production startup is blocked: an external identity provider is not configured.",
  );
}

/** Request-time guard for direct Next deployments that bypass server.ts. */
export function assertApplicationAuthenticationAvailable(
  environment: AuthenticationRuntimeEnvironment = process.env,
): void {
  if (isPublicReviewMode(environment)) {
    assertPublicReviewConfiguration(environment);
    return;
  }
  if (isGoogleIapMode(environment)) {
    readIapConfiguration(environment);
    return;
  }
  if (environment.DONGHAENG_AUTH_MODE?.trim()) {
    throw new ApplicationError(503, "AUTH_MODE_INVALID", "지원되지 않는 인증 방식입니다.");
  }
  if (environment.NODE_ENV?.trim().toLowerCase() !== "production") return;
  const fingerprint = exactGateFingerprint(environment);
  if (
    fingerprint &&
    authenticationRuntime.__donghaengProductionE2EAuthAttestation === fingerprint
  ) {
    return;
  }
  throw new ApplicationError(
    503,
    "PRODUCTION_IDP_NOT_CONFIGURED",
    "운영 인증 공급자가 구성되지 않아 요청을 처리할 수 없습니다.",
  );
}
