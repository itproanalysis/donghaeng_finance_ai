export type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * The custom server uses `--dev` as the authoritative runtime switch.  npm
 * does not set NODE_ENV for arbitrary scripts, so leaving it unset on
 * `npm start` must never silently enable local bootstrap, relaxed Origin
 * checks, insecure cookies, or the deterministic interview provider.
 */
export function applyCustomServerRuntimeMode(
  development: boolean,
  environment: RuntimeEnvironment = process.env,
): "development" | "production" {
  const expected = development ? "development" : "production";
  const configured = environment.NODE_ENV?.trim().toLowerCase();
  if (configured && configured !== expected) {
    throw new Error(
      `Custom server mode conflict: --dev=${development} requires NODE_ENV=${expected}.`,
    );
  }
  environment.NODE_ENV = expected;
  return expected;
}
