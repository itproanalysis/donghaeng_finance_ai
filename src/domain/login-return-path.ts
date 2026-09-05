/** Login may return only to actual app journeys, never an external URL or login loop. */
export function safeLoginReturnPath(value: unknown): string {
  if (typeof value !== "string" || /[\\\u0000-\u0020]/.test(value)) return "/";
  if (value === "/") return value;
  if (!/^\/(?:borrower|interviews|interview-evaluations)(?:[/?#]|$)/.test(value)) return "/";
  try {
    const url = new URL(value, "https://donghaeng.invalid");
    return url.origin === "https://donghaeng.invalid" && /^\/(?:borrower|interviews|interview-evaluations)(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}
