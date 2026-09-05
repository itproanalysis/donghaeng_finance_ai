/** Keep two minutes for STT + persistence; the next WebSocket handshake gets a fresh IAP assertion. */
export function iapAudioRenewalDelay(expiresAt: string, nowMs: number): number {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) throw new Error("Invalid verified IAP expiry");
  return Math.max(1_000, expiryMs - nowMs - 120_000);
}
