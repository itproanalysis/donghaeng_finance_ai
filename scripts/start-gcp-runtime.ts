/** Fetch runtime credentials directly into memory using the VM workload identity. */
import { assertPublicReviewConfiguration, isPublicReviewMode } from "../src/server/public-review";
const project = process.env.DONGHAENG_GCP_PROJECT_ID;
if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error("GCP project is required.");
if (isPublicReviewMode()) assertPublicReviewConfiguration();
else if (process.env.DONGHAENG_AUTH_MODE !== "google-iap") throw new Error("GCP runtime requires an explicitly configured authentication mode.");

async function credentialJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Runtime credential retrieval failed (${response.status}).`);
  const text = await response.text();
  if (text.length > 32_768) throw new Error("Runtime credential response is too large.");
  return JSON.parse(text) as Record<string, unknown>;
}

async function start() {
  const token = await credentialJson("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (typeof token.access_token !== "string") throw new Error("Workload identity is unavailable.");
  for (const [key, secret] of [["ANTHROPIC_API_KEY", "donghaeng-anthropic-api-key"], ["OPENAI_API_KEY", "donghaeng-openai-api-key"]]) {
    const result = await credentialJson(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secret}/versions/latest:access`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const payload = result.payload as { data?: unknown } | undefined;
    if (typeof payload?.data !== "string") throw new Error("Runtime credential payload is missing.");
    const value = Buffer.from(payload.data, "base64").toString("utf8").trim();
    if (!value.startsWith("sk-") || value.length > 2048 || /\s/.test(value)) throw new Error("Runtime credential format is invalid.");
    process.env[key!] = value;
  }
  process.env.DONGHAENG_TTS_API_KEY = process.env.OPENAI_API_KEY;
  await import("../server");
}
void start().catch(() => { console.error("GCP runtime could not initialize its protected configuration."); process.exitCode = 1; });
export {};
