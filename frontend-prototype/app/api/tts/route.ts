const TYPECAST_TTS_URL = "https://api.typecast.ai/v1/text-to-speech";
const INTERVIEWER_VOICE_ID = "tc_694b51e6dc12c8f4ec1a959c";

export async function POST(request: Request) {
  const apiKey = process.env.TYPECAST_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "인터뷰어 음성 키가 아직 연결되지 않았습니다." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text || text.length > 1000) {
    return Response.json({ error: "읽을 내용을 확인해 주세요." }, { status: 400 });
  }

  try {
    const upstream = await fetch(TYPECAST_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        voice_id: INTERVIEWER_VOICE_ID,
        text,
        model: "ssfm-v30",
        language: "kor",
        prompt: {
          emotion_type: "preset",
          emotion_preset: "normal",
          emotion_intensity: 0.8,
        },
        output: {
          volume: 100,
          audio_pitch: 0,
          audio_tempo: 0.92,
          audio_format: "wav",
        },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("Typecast TTS failed", upstream.status, detail.slice(0, 300));
      return Response.json(
        { error: `Typecast 음성 요청이 거절되었습니다. (${upstream.status})` },
        { status: 502 },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Typecast TTS failed", error);
    const reason = error instanceof Error ? error.message : "unknown error";
    return Response.json({ error: `Typecast 연결 오류: ${reason.slice(0, 80)}` }, { status: 502 });
  }
}
