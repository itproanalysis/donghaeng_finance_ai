import http from "node:http";

const backend = new URL("http://10.80.0.40:3000");
const canonical = new URL(process.env.DONGHAENG_APP_ORIGIN);
if (canonical.protocol !== "https:" || !/^donghaeng-finance-review-[a-z0-9.-]+\.run\.app$/.test(canonical.hostname)) throw new Error("Explicit review origin required");
const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const securityHeaders = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000", "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};
function forwardedHeaders(request) {
  const headers = { ...request.headers };
  for (const key of Object.keys(headers)) {
    if (/^(authorization|forwarded|x-real-ip|x-goog-|x-forwarded-|x-donghaeng-)/i.test(key)) delete headers[key];
  }
  headers.host = canonical.host;
  headers["x-forwarded-host"] = canonical.host;
  headers["x-forwarded-proto"] = "https";
  // No unverified client IP is used for quota decisions. Durable global and
  // tenant limits are independently enforced by the application.
  return headers;
}
function validPath(path) { return typeof path === "string" && path.startsWith("/") && !path.startsWith("//"); }
const server = http.createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { ...securityHeaders, "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", mode: "isolated-public-review-gateway" })); return;
  }
  if (!validPath(request.url)) { response.writeHead(400, securityHeaders); response.end(); return; }
  if (request.headers.host !== canonical.host) {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(403, securityHeaders); response.end(); return; }
    response.writeHead(308, { ...securityHeaders, Location: canonical.origin + request.url }); response.end(); return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== canonical.origin) {
    response.writeHead(403, securityHeaders); response.end("Invalid origin"); return;
  }
  const upstream = http.request({ hostname: backend.hostname, port: backend.port, path: request.url, method: request.method, headers: forwardedHeaders(request), agent }, incoming => {
    response.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, ...securityHeaders });
    incoming.pipe(response); incoming.on("error", () => response.destroy());
  });
  upstream.setTimeout(125_000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
    response.end("상담소를 연결하고 있습니다. 잠시 후 새로고침해 주세요.");
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});
server.on("upgrade", (request, socket, head) => {
  if (request.headers.host !== canonical.host || request.headers.origin !== canonical.origin ||
      !/^\/ws\/interviews\/[^/?]+\/audio$/.test(request.url ?? "")) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
  }
  const upstream = http.request({ hostname: backend.hostname, port: backend.port, path: request.url, method: "GET", headers: forwardedHeaders(request) });
  upstream.on("upgrade", (incoming, other, upstreamHead) => {
    other.setTimeout(0); socket.setTimeout(0);
    const lines = Object.entries(incoming.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => `${key}: ${item}`) : value === undefined ? [] : [`${key}: ${value}`]);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) other.write(head);
    socket.pipe(other).pipe(socket);
    socket.on("error", () => other.destroy()); other.on("error", () => socket.destroy());
    socket.on("close", () => other.destroy()); other.on("close", () => socket.destroy());
  });
  upstream.on("response", incoming => { socket.end(`HTTP/1.1 ${incoming.statusCode ?? 502} Rejected\r\nConnection: close\r\n\r\n`); incoming.resume(); });
  upstream.on("error", () => socket.destroy());
  upstream.setTimeout(15_000, () => upstream.destroy()); upstream.end();
});
server.headersTimeout = 15_000;
server.requestTimeout = 125_000;
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
process.once("SIGTERM", () => { server.close(); agent.destroy(); setTimeout(() => process.exit(0), 8000).unref(); });
