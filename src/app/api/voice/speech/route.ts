import { assertSameOriginMutation } from "@/server/auth";
import { apiFailure, readJsonObject, requestIdFor } from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST, synthesizeQuestionSpeech } from "@/server/question-speech";
import { getAuthService } from "@/server/service-instance";
import { ConsentService } from "@/server/consent-service";
import { getDatabase } from "@/server/database";
import { isPublicReviewMode, reserveReviewUsage } from "@/server/public-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSpeechText(body: Record<string, unknown>): string {
  const unknownKeys = Object.keys(body).filter((key) => !["text", "interviewId"].includes(key));
  if (unknownKeys.length > 0 || typeof body.text !== "string") {
    throw new ApplicationError(400, "INVALID_QUESTION_SPEECH_REQUEST", "읽을 질문만 전달할 수 있습니다.");
  }
  return body.text;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    const principal = getAuthService().authenticate(request);
    const body = await readJsonObject(request);
    const text = readSpeechText(body);
    if (isPublicReviewMode() && (!text.trim() || text.length > 1000)) {
      throw new ApplicationError(400, "INVALID_QUESTION_SPEECH_REQUEST", "한 번에 읽을 질문은 1,000자 이내로 입력해 주세요.");
    }
    const interviewId = body.interviewId;
    if (interviewId !== undefined && (typeof interviewId !== "string" || !interviewId.trim() || interviewId.length > 128)) {
      throw new ApplicationError(400, "INVALID_QUESTION_SPEECH_REQUEST", "인터뷰 연결 정보가 올바르지 않습니다.");
    }
    const endpoint = new URL(process.env.DONGHAENG_TTS_ENDPOINT || "http://127.0.0.1:8766/v1/audio/speech");
    const cloud = !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
    if (cloud) {
      if (endpoint.protocol !== "https:") throw new ApplicationError(503, "QUESTION_TTS_HTTPS_REQUIRED", "외부 음성 서비스에는 HTTPS가 필요합니다.");
      if (typeof interviewId === "string") {
        new ConsentService(getDatabase()).assertEffectiveConsent(interviewId, "CLOUD_AI_PROCESSING", principal);
      } else if (!PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST.includes(text.trim())) {
        throw new ApplicationError(403, "QUESTION_TTS_INTERVIEW_REQUIRED", "맞춤 질문의 음성 재생에는 인터뷰 처리 동의가 필요합니다.");
      }
    }
    reserveReviewUsage(getDatabase(), "tts", principal.tenantId);
    const speech = await synthesizeQuestionSpeech(text);
    return new Response(new Uint8Array(speech.bytes).buffer, {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Content-Length": String(speech.bytes.byteLength),
        // Personalized audio is not written to browser HTTP caches. The
        // interview-scoped, bounded in-memory player still supports replay.
        "Cache-Control": "no-store",
        "X-Speech-Provider": endpoint.hostname === "api.openai.com" ? "openai" : cloud ? "server" : "qwen",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
