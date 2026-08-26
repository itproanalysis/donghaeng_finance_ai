import { pathToFileURL } from "node:url";

import {
  inspectPersistentQuestionSpeechCache,
} from "../src/server/question-speech";

const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 90_000;

function localOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error("--origin은 로컬 HTTP origin만 사용할 수 있습니다.");
  }
  return url.origin;
}

function parseOrigin(arguments_: readonly string[]): string {
  if (arguments_.length === 0) return DEFAULT_ORIGIN;
  if (arguments_.length === 2 && arguments_[0] === "--origin" && arguments_[1]) {
    return localOrigin(arguments_[1]);
  }
  throw new Error("사용법: npm run voice:prewarm -- --origin http://127.0.0.1:3000");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: "error" });
  } finally {
    clearTimeout(timeout);
  }
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";", 1)[0]?.trim() ?? "";
  if (!cookie.startsWith("donghaeng_session=")) {
    throw new Error("로컬 사전 준비 세션 쿠키를 받지 못했습니다.");
  }
  return cookie;
}

function elapsedSeconds(startedAt: number): string {
  return ((performance.now() - startedAt) / 1_000).toFixed(1);
}

export async function runQuestionSpeechPrewarm(originInput: string): Promise<void> {
  const origin = localOrigin(originInput);
  const startedAt = performance.now();
  const initial = await inspectPersistentQuestionSpeechCache();
  console.log(
    `[동행금융AI] AI 질문 음성 캐시 ${initial.cached}/${initial.total}개 확인 ` +
      `(${initial.model}, ${initial.voice}).`,
  );
  if (initial.missingTexts.length === 0) {
    console.log(`[동행금융AI] 추가 생성 없이 준비 완료 (${elapsedSeconds(startedAt)}초).`);
    return;
  }

  console.log(
    `[동행금융AI] 누락된 ${initial.missingTexts.length}개 음성을 순서대로 준비합니다. ` +
      "최초 1회에는 몇 분이 걸릴 수 있으며 중단 후 다시 실행하면 이어서 준비됩니다.",
  );

  let cookie = "";
  let failures = 0;
  try {
    const bootstrap = await fetchWithTimeout(`${origin}/api/auth/bootstrap`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        Origin: origin,
      },
      body: "{}",
    }, 10_000);
    if (bootstrap.status !== 201) {
      throw new Error(`로컬 사전 준비 세션 생성 실패 (HTTP ${bootstrap.status}).`);
    }
    cookie = sessionCookie(bootstrap);

    for (let index = 0; index < initial.missingTexts.length; index += 1) {
      const itemStartedAt = performance.now();
      const text = initial.missingTexts[index];
      if (!text) continue;
      try {
        const response = await fetchWithTimeout(`${origin}/api/voice/speech`, {
          method: "POST",
          headers: {
            Accept: "audio/wav, audio/*;q=0.8",
            "Content-Type": "application/json; charset=utf-8",
            Cookie: cookie,
            Origin: origin,
          },
          body: JSON.stringify({ text }),
        });
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!response.ok || !contentType.startsWith("audio/")) {
          throw new Error(`HTTP ${response.status}`);
        }
        await response.arrayBuffer();
        console.log(
          `[동행금융AI] 음성 준비 ${index + 1}/${initial.missingTexts.length} 완료 ` +
            `(${elapsedSeconds(itemStartedAt)}초).`,
        );
      } catch (error) {
        failures += 1;
        const reason = error instanceof Error ? error.message : "알 수 없는 오류";
        console.error(
          `[동행금융AI] 음성 준비 ${index + 1}/${initial.missingTexts.length} 실패: ${reason}`,
        );
      }
    }
  } finally {
    if (cookie) {
      await fetchWithTimeout(`${origin}/api/auth/session`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Cookie: cookie,
          Origin: origin,
        },
      }, 5_000).catch(() => undefined);
    }
  }

  const finalCoverage = await inspectPersistentQuestionSpeechCache();
  if (failures > 0 || finalCoverage.cached !== finalCoverage.total) {
    throw new Error(
      `AI 질문 음성 캐시가 ${finalCoverage.cached}/${finalCoverage.total}개만 준비되었습니다. ` +
        "같은 명령을 다시 실행하면 누락분부터 이어서 준비합니다.",
    );
  }
  console.log(
    `[동행금융AI] AI 질문 음성 ${finalCoverage.cached}/${finalCoverage.total}개 준비 완료 ` +
      `(${elapsedSeconds(startedAt)}초).`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  let origin: string;
  try {
    origin = parseOrigin(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "사전 준비 인수를 확인할 수 없습니다.");
    process.exitCode = 1;
    origin = "";
  }
  if (origin) {
    runQuestionSpeechPrewarm(origin).catch((error) => {
      console.error(error instanceof Error ? error.message : "AI 질문 음성 사전 준비에 실패했습니다.");
      process.exitCode = 1;
    });
  }
}
