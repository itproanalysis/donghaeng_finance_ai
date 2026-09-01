import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Donghaeng Finance journey", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>동행금융 \| 다시 금융과 만나는 세 걸음<\/title>/i);
  assert.match(html, /다시 문을 여는 길/);
  assert.match(html, /퀘스트 0 \/ 3/);
  assert.match(html, /최근 매출이 줄어든 가장 큰 이유/);
  assert.match(html, /상황을 말로 풀어내기/);
  assert.match(html, /현금흐름 습관 만들기/);
  assert.match(html, /상담 자료 준비하기/);
  assert.match(html, /5fecb680/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps the three-mission experience and demo route connected", async () => {
  const [page, layout, scene, demo] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ThreeMissionRoadScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demo/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal((page.match(/title:/g) ?? []).length, 3);
  assert.equal((page.match(/question:/g) ?? []).length, 3);
  assert.equal((page.match(/reward:/g) ?? []).length, 3);
  assert.match(page, /answerQuest/);
  assert.match(page, /router\.push\("\/demo"\)/);
  assert.match(scene, /donghaeng:progress/);
  assert.match(scene, /CatmullRomCurve3/);
  assert.match(layout, /동행금융 \| 다시 금융과 만나는 세 걸음/);
  assert.match(demo, /동행금융 홈페이지로 돌아가기/);
});
