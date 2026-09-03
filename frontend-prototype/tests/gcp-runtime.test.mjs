import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let logs = "";
before(async () => {
  server = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => {
    logs += chunk.toString();
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) {
      baseUrl = match[0];
      return;
    }
    if (server.exitCode !== null) throw new Error(logs);
    await delay(100);
  }
  throw new Error(`Server did not start: ${logs}`);
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
});

test("Cloud Run runtime serves the original journey and every added route", async () => {
  const markers = {
    "/": ["다시 문을 여는 길", "퀘스트 0 / 3", "현금흐름 습관 만들기"],
    "/demo": ["동행금융 홈페이지로 돌아가기", "인터뷰"],
    "/results": ["결과", "동행"],
    "/admin": ["관리자", "현황"],
    "/guide": ["사장님", "관리자"],
  };
  for (const [path, expected] of Object.entries(markers)) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    for (const marker of expected)
      assert.ok(html.includes(marker), `${path}: ${marker}`);
    assert.doesNotMatch(
      html,
      /Your site is taking shape|Internal Server Error/,
    );
  }
});

test("runtime includes health, original portrait, and all three interviewer recordings", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((res) => res.json());
  assert.deepEqual(health, {
    status: "ok",
    service: "donghaeng-finance",
    source: "frontend-prototype",
  });
  for (const path of [
    "/interviewer-yujin.png",
    "/audio/yujin-q1.wav",
    "/audio/yujin-q2.wav",
    "/audio/yujin-q3.wav",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 1000, path);
  }
  assert.equal((await fetch(`${baseUrl}/not-a-donghaeng-page`)).status, 404);
});
