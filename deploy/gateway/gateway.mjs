import http from "node:http";

const backend = new URL(process.env.DONGHAENG_BACKEND_URL ?? "http://10.80.0.10:3000");
if (backend.protocol !== "http:" || backend.hostname !== "10.80.0.10" || backend.port !== "3000") {
  throw new Error("The gateway requires the dedicated private backend.");
}
const port = Number(process.env.PORT ?? 8080);
const canonicalOrigin = "https://donghaeng-finance-ai-jy5k5cvnjq-du.a.run.app";
const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const server = http.createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ status: "ok", mode: "private-live-gateway" }));
    return;
  }
  // IAP supplies a signed assertion, not a trusted plain-text email header.
  // The application verifies it cryptographically and checks its own allowlist.
  if (!request.headers["x-goog-iap-jwt-assertion"]) {
    response.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Google 계정으로 로그인해 주세요.");
    return;
  }
  if (request.headers.host === "donghaeng-finance-ai-470320899177.asia-northeast3.run.app") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("기본 서비스 주소에서 다시 시도해 주세요.");
      return;
    }
    response.writeHead(308, { Location: canonicalOrigin + (request.url?.startsWith("/") ? request.url : "/"), "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const headers = { ...request.headers, "x-forwarded-proto": "https" };
  delete headers["x-goog-authenticated-user-email"];
  delete headers["x-goog-authenticated-user-id"];
  const upstream = http.request({ hostname: backend.hostname, port: backend.port, path: request.url, method: request.method, headers, agent }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, {
      ...incoming.headers,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
      "Strict-Transport-Security": "max-age=31536000",
      "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    });
    incoming.pipe(response);
    incoming.on("error", () => response.destroy());
  });
  upstream.setTimeout(125_000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("인터뷰 서버를 연결하는 중입니다. 잠시 후 다시 접속해 주세요.");
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  if (!request.headers["x-goog-iap-jwt-assertion"] || !/^\/ws\/interviews\/[^/?]+\/audio(?:\?|$)/.test(request.url ?? "")) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const headers = { ...request.headers, "x-forwarded-proto": "https" };
  delete headers["x-goog-authenticated-user-email"];
  delete headers["x-goog-authenticated-user-id"];
  const upstream = http.request({ hostname: backend.hostname, port: backend.port, path: request.url, method: "GET", headers });
  upstream.on("upgrade", (incoming, upstreamSocket, upstreamHead) => {
    upstreamSocket.setTimeout(0);
    socket.setTimeout(0);
    const lines = Object.entries(incoming.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => `${key}: ${item}`) : value === undefined ? [] : [`${key}: ${value}`]);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => socket.destroy());
  });
  upstream.on("response", (incoming) => { socket.end(`HTTP/1.1 ${incoming.statusCode ?? 502} Rejected\r\nConnection: close\r\n\r\n`); incoming.resume(); });
  upstream.on("error", () => socket.destroy());
  upstream.setTimeout(15_000, () => upstream.destroy());
  upstream.end();
});
server.headersTimeout = 15_000;
server.requestTimeout = 125_000;
server.listen(port, "0.0.0.0");
process.once("SIGTERM", () => { server.close(); agent.destroy(); setTimeout(() => process.exit(0), 8000).unref(); });
