"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MosaicCurtain from "../components/MosaicCurtain";

const questions = [
  { question: "최근 매출이 달라진 가장 큰 이유를 들려주세요.", audioSrc: "/audio/yujin-q1.wav", options: ["리뉴얼 후 다시 영업을 시작했어요.", "새로운 납품 계약이 생겼어요."] },
  { question: "그 변화가 지금도 이어지고 있나요?", audioSrc: "/audio/yujin-q2.wav", options: ["최근 3개월 매출이 안정됐어요.", "단골 고객과 주문이 다시 늘었어요."] },
  { question: "다음 금융 검토를 위해 먼저 준비할 수 있는 자료는 무엇인가요?", audioSrc: "/audio/yujin-q3.wav", options: ["최근 매출 정산 자료를 준비할 수 있어요.", "상환 계획을 다시 확인할 수 있어요."] },
];

function timeLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function DemoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [seconds, setSeconds] = useState(14);
  const current = questions[step];

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => {
      window.clearInterval(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
    };
  }, []);

  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      setMicOn(true);
    } catch {
      setCameraError("카메라와 마이크 권한을 허용하면 내 화면을 연결할 수 있어요.");
    }
  }

  function toggleCamera() {
    if (!streamRef.current) {
      void startCamera();
      return;
    }
    const next = !cameraOn;
    streamRef.current.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  }

  function toggleMic() {
    if (!streamRef.current) return;
    const next = !micOn;
    streamRef.current.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  }

  async function speak(audioSrc: string) {
    audioRef.current?.pause();
    setVoiceError("");
    setSpeaking(true);
    try {
      const audio = new Audio(audioSrc);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => { setSpeaking(false); setVoiceError("음성을 재생하지 못했어요. 다시 시도해 주세요."); };
      await audio.play();
    } catch (error) {
      setSpeaking(false);
      setVoiceError(error instanceof Error ? error.message : "음성을 준비하지 못했어요.");
    }
  }

  function sendAnswer() {
    if (!answer.trim()) return;
    setAnswers((items) => [...items, answer]);
    const nextStep = Math.min(step + 1, questions.length - 1);
    setAnswer("");
    setStep(nextStep);
    window.setTimeout(() => { void speak(questions[nextStep].audioSrc); }, 120);
  }

  return (
    <main className="video-call-demo">
      <header className="video-call-topbar">
        <button
          type="button"
          className="video-call-brand"
          aria-label="동행금융 홈페이지로 돌아가기"
          onClick={() => window.location.assign("/")}
        >
          동행금융
        </button>
        <p>AI 신용 회복 인터뷰</p>
        <Link href="/" className="video-call-exit">통화 나가기</Link>
      </header>

      <section className="video-call-layout" aria-label="AI 인터뷰 영상 통화">
        <div className="video-stage">
          <div className="video-stage-head"><span><i aria-hidden="true" /> 연결됨</span><time>{timeLabel(seconds)}</time></div>
          <video className={`local-video ${cameraOn ? "visible" : ""}`} ref={videoRef} autoPlay muted playsInline aria-label="내 카메라 화면" />
          {!cameraOn && <div className="camera-empty"><span>내 카메라</span><strong>화면을 연결해<br />대화를 시작해 볼까요?</strong><p>카메라와 마이크는 이 데모 화면에서만 사용됩니다.</p><button onClick={() => void startCamera()}>카메라 켜기</button>{cameraError && <small role="alert">{cameraError}</small>}</div>}
          <div className="interviewer-pip"><img src="/interviewer-yujin.png" alt="AI 인터뷰어 유진" /><div><span>AI 인터뷰어</span><strong>유진</strong><i className={speaking ? "is-speaking" : ""}>{speaking ? "말하는 중" : "대기 중"}</i></div></div>
          <div className="video-controls"><button onClick={toggleMic} aria-pressed={micOn}>{micOn ? "마이크 켜짐" : "마이크 꺼짐"}</button><button onClick={toggleCamera} aria-pressed={cameraOn}>{cameraOn ? "카메라 켜짐" : "카메라 꺼짐"}</button><button className="tts-button" onClick={() => void speak(current.audioSrc)} disabled={speaking}>{speaking ? "유진이 말하는 중" : "유진 목소리 듣기"}</button></div>
          {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
        </div>

        <aside className="live-transcript" aria-label="실시간 대화 기록">
          <header><div><span>LIVE TRANSCRIPT</span><strong>대화 기록</strong></div><p>질문 {step + 1} / {questions.length}</p></header>
          <div className="transcript-thread" aria-live="polite">
            <div className="transcript-message agent"><span>유진 · AI 인터뷰어</span><p>안녕하세요, 지원님. 오늘은 점수보다 사업의 회복 이야기를 먼저 들을게요.</p></div>
            {answers.map((item, index) => <div className="transcript-message user" key={`${item}-${index}`}><span>지원님</span><p>{item}</p></div>)}
            <div className="transcript-message agent current"><span>유진 · AI 인터뷰어 {speaking && <i>말하는 중</i>}</span><p>{current.question}</p></div>
          </div>
          <footer className="transcript-reply"><p>빠른 답변</p><div>{current.options.map((option) => <button key={option} className={answer === option ? "selected" : ""} onClick={() => setAnswer(option)} aria-pressed={answer === option}>{option}</button>)}</div><label><span className="sr-only">직접 답변하기</span><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="직접 답변하기" rows={2} /><button onClick={sendAnswer} disabled={!answer.trim()}>보내기</button></label></footer>
        </aside>
      </section>

      <p className="video-call-note">AI가 인터뷰를 진행하고 대화를 검토 근거로 정리합니다. 최종 대출 판단은 금융기관과 사람이 합니다.</p>
      <MosaicCurtain mode="reveal" />
    </main>
  );
}
