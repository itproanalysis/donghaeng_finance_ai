import { assertSameOriginMutation } from "@/server/auth";
import { apiFailure, readJsonObject, requestIdFor } from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { synthesizeQuestionSpeech } from "@/server/question-speech";
import { getAuthService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSpeechText(body: Record<string, unknown>): string {
  const unknownKeys = Object.keys(body).filter((key) => key !== "text");
  if (unknownKeys.length > 0 || typeof body.text !== "string") {
    throw new ApplicationError(400, "INVALID_QUESTION_SPEECH_REQUEST", "읽을 질문만 전달할 수 있습니다.");
  }
  return body.text;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOriginMutation(request);
    getAuthService().authenticate(request);
    const text = readSpeechText(await readJsonObject(request));
    const speech = await synthesizeQuestionSpeech(text);
    return new Response(new Uint8Array(speech.bytes).buffer, {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Content-Length": String(speech.bytes.byteLength),
        // Audio is personalized only by the supplied server-generated text.
        // Keep it private while allowing the same browser to replay without a
        // second synthesis request.
        "Cache-Control": "private, max-age=300",
        "Vary": "Cookie, Authorization",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
