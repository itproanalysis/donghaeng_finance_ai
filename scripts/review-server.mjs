import http from "node:http";
import { pathToFileURL } from "node:url";

/** The public review server serves a fixed synthetic UI only. No real API is exposed. */
export function permittedReviewPath(method, rawUrl) {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = (rawUrl ?? "").split("?")[0];
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[%\\\u0000-\u0020]/.test(path) ||
    path.split("/").includes("..")
  )
    return false;
  return (
    ["/", "/demo/borrower", "/demo/admin", "/healthz"].includes(path) ||
    /^\/_next\/static\/[a-zA-Z0-9_./()\[\]@-]+$/.test(path)
  );
}

export async function startReviewServer() {
  process.env.NODE_ENV = "production";
  process.env.DONGHAENG_PUBLIC_DEMO = "1";
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  const { default: next } = await import("next");
  const app = next({ dev: false, hostname: "0.0.0.0", port });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'",
    );
    if (!permittedReviewPath(request.method, request.url)) {
      response.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error: "REVIEW_ONLY",
          message:
            "공개 체험은 가상 사례만 제공합니다. 실제 인터뷰 API는 제공하지 않습니다.",
        }),
      );
      return;
    }
    if (request.url.split("?")[0] === "/healthz") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ status: "ok", mode: "synthetic-review" }));
      return;
    }
    try {
      await handler(request, response);
    } catch {
      if (!response.headersSent)
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
      response.end("화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  });
  // This runtime never accepts microphone sessions, WebSockets or write requests.
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.listen(port, "0.0.0.0", () =>
    console.log(`Donghaeng public review: http://127.0.0.1:${port}`),
  );
  async function shutdown() {
    const deadline = setTimeout(() => process.exit(1), 9000);
    deadline.unref();
    await new Promise((resolve) => server.close(resolve));
    await app.close();
    clearTimeout(deadline);
    process.exit(0);
  }
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startReviewServer().catch(() => {
    console.error("Public review server failed to start.");
    process.exitCode = 1;
  });
}
