"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import MosaicCurtain from "../components/MosaicCurtain";
import { ServiceLinks, FlowSteps } from "../components/ServiceNavigation";
import {
  INTERVIEW_QUESTIONS,
  QUEST_LABELS,
  acceptAnswer,
  completeCase,
} from "../lib/case-model";
import { saveCase, startCase, useCases } from "../lib/case-store";

function timeLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function DemoPage() {
  const router = useRouter();
  const { current: record, ready, unavailable } = useCases();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [checked, setChecked] = useState(false);
  const [storageConsent, setStorageConsent] = useState(false);
  const question =
    INTERVIEW_QUESTIONS.find((q) => q.id === editId) ??
    INTERVIEW_QUESTIONS.find(
      (q) => !record?.answers.some((a) => a.questionId === q.id),
    );
  const reviewing = !!record && record.answers.length === 3 && !question;
  const profileReady = !!record?.businessName;
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileReady || record?.completedAt) return;
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [profileReady, record?.completedAt]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
    },
    [],
  );
  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [record?.answers.length, question?.id]);
  function beginProfile() {
    if (!businessName.trim() || !storageConsent) return;
    try {
      const item = record && !record.completedAt ? record : startCase();
      saveCase({
        ...item,
        businessName: businessName.trim(),
        borrowerName: borrowerName.trim(),
        updatedAt: new Date().toISOString(),
      });
      setSaveError("");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    }
  }
  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch {
      setCameraError(
        "카메라를 연결하지 못했어요. 입력창으로 인터뷰를 이어갈 수 있습니다.",
      );
    }
  }
  function toggleCamera() {
    if (!streamRef.current) {
      void startCamera();
      return;
    }
    const next = !cameraOn;
    streamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    setCameraOn(next);
  }
  async function speak(audioSrc: string) {
    audioRef.current?.pause();
    setVoiceError("");
    setSpeaking(true);
    try {
      const audio = new Audio(audioSrc);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => {
        setSpeaking(false);
        setVoiceError("음성을 재생하지 못했어요. 질문을 읽고 답변해 주세요.");
      };
      await audio.play();
    } catch {
      setSpeaking(false);
      setVoiceError(
        "자동 재생이 제한됐어요. ‘유진 목소리 듣기’를 다시 눌러주세요.",
      );
    }
  }
  function sendAnswer() {
    if (!record || !question || !answer.trim()) return;
    try {
      const next = acceptAnswer(
        record,
        question.id,
        answer,
        new Date().toISOString(),
      );
      saveCase(next);
      audioRef.current?.pause();
      setSpeaking(false);
      setAnswer("");
      setEditId(null);
      setChecked(false);
      setSaveError("");
      const nextQuestion = INTERVIEW_QUESTIONS.find(
        (q) => !next.answers.some((a) => a.questionId === q.id),
      );
      if (nextQuestion) void speak(nextQuestion.audioSrc);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    }
  }
  function finish() {
    if (!record || !checked) return;
    try {
      saveCase(completeCase(record, new Date().toISOString()));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      router.push("/results");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "완료하지 못했습니다.",
      );
    }
  }
  function newInterview() {
    try {
      startCase();
      setAnswer("");
      setEditId(null);
      setChecked(false);
      setBusinessName("");
      setBorrowerName("");
      setStorageConsent(false);
      setSeconds(0);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "시작하지 못했습니다.",
      );
    }
  }

  return (
    <main className="video-call-demo connected-interview">
      <header className="video-call-topbar">
        <button
          type="button"
          className="video-call-brand"
          aria-label="동행금융 홈페이지로 돌아가기"
          onClick={() => router.push("/")}
        >
          동행금융
        </button>
        <p>사장님의 회복 이야기</p>
        <ServiceLinks compact />
      </header>
      <div className="interview-progress-wrap">
        <FlowSteps active={record?.completedAt ? 3 : reviewing ? 2 : 1} />
        <p>골목에서 선택한 내용 → 인터뷰 답변 → 결과와 다음 동행</p>
      </div>
      {!ready ? (
        <p className="interview-loading" role="status">
          저장된 이야기를 불러옵니다.
        </p>
      ) : record?.completedAt ? (
        <section className="interview-profile">
          <span className="companion-kicker">인터뷰 완료</span>
          <h1>{record.businessName} 이야기를 확인했어요.</h1>
          <p>완료된 원문과 개선 후보를 결과 화면에서 확인할 수 있습니다.</p>
          <div className="companion-actions">
            <Link className="companion-button" href="/results">
              내 결과 보기 →
            </Link>
            <button
              className="companion-button companion-button--light"
              onClick={newInterview}
            >
              새 인터뷰 시작
            </button>
          </div>
        </section>
      ) : !profileReady ? (
        <section className="interview-profile">
          <span className="companion-kicker">유진과의 첫 만남</span>
          <h1>어떤 가게 이야기를 들려주실 건가요?</h1>
          <p>
            유진의 질문 음성을 듣고 직접 답변을 입력합니다. 카메라는 내 화면
            미리보기이며, 음성 답변 전사 기능은 아직 연결되지 않았습니다.
          </p>
          {record?.quests.some(Boolean) && (
            <div className="quest-context">
              {record.quests.map(
                (q, i) =>
                  q && (
                    <span key={i}>
                      {QUEST_LABELS[i]} · {q}
                    </span>
                  ),
              )}
            </div>
          )}
          <div className="companion-fields">
            <label>
              사업체 이름
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="가게 이름을 알려주세요"
                maxLength={80}
              />
            </label>
            <label>
              사장님 호칭 <small>선택</small>
              <input
                value={borrowerName}
                onChange={(e) => setBorrowerName(e.target.value)}
                placeholder="어떻게 불러드리면 좋을까요?"
                maxLength={80}
              />
            </label>
          </div>
          <label className="companion-check">
            <input
              type="checkbox"
              checked={storageConsent}
              onChange={(e) => setStorageConsent(e.target.checked)}
            />
            <span>
              답변과 검토 초안을 이 브라우저에 저장하는 것을 확인했습니다.
              <small>
                공용 기기에서는 이용 후 관리자 화면에서 기록을 삭제해 주세요.
                외부 AI·금융기관으로 답변을 전송하지 않습니다.
              </small>
            </span>
          </label>
          <button
            className="companion-button"
            onClick={beginProfile}
            disabled={!businessName.trim() || !storageConsent || unavailable}
          >
            유진과 이야기 시작하기 →
          </button>
        </section>
      ) : (
        <section className="video-call-layout" aria-label="사장님 인터뷰">
          <div className="video-stage">
            <div className="video-stage-head">
              <span>
                <i aria-hidden="true" />
                {cameraOn ? "카메라 미리보기" : "질문·답변 인터뷰"}
              </span>
              <time>{timeLabel(seconds)}</time>
            </div>
            <video
              className={`local-video ${cameraOn ? "visible" : ""}`}
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="내 카메라 화면"
            />
            {!cameraOn && (
              <div className="camera-empty">
                <span>{record.businessName}</span>
                <strong>
                  가게의 다음 이야기를
                  <br />
                  함께 정리해 볼까요?
                </strong>
                <p>화면을 켜지 않아도 인터뷰를 이어갈 수 있어요.</p>
                <button onClick={() => void startCamera()}>
                  내 카메라 미리보기
                </button>
                {cameraError && <small role="alert">{cameraError}</small>}
              </div>
            )}
            <div className="interviewer-pip">
              <img src="/interviewer-yujin.png" alt="AI 인터뷰어 유진" />
              <div>
                <span>동행 인터뷰어</span>
                <strong>유진</strong>
                <i className={speaking ? "is-speaking" : ""}>
                  {speaking
                    ? "질문 음성 재생 중"
                    : reviewing
                      ? "답변 확인을 기다려요"
                      : "사장님 이야기를 기다려요"}
                </i>
              </div>
            </div>
            <div className="video-controls">
              <button onClick={toggleCamera} aria-pressed={cameraOn}>
                {cameraOn ? "카메라 켜짐" : "카메라 꺼짐"}
              </button>
              {question && (
                <button
                  className="tts-button"
                  onClick={() => void speak(question.audioSrc)}
                  disabled={speaking}
                >
                  {speaking ? "유진이 말하는 중" : "유진 목소리 듣기"}
                </button>
              )}
            </div>
            {voiceError && (
              <p className="voice-error" role="alert">
                {voiceError}
              </p>
            )}
          </div>
          <aside className="live-transcript" aria-label="질문과 답변 기록">
            <header>
              <div>
                <span>OUR CONVERSATION</span>
                <strong>{reviewing ? "마지막 답변 확인" : "대화 기록"}</strong>
              </div>
              <p>
                {reviewing
                  ? "3개 답변 완료"
                  : `질문 ${INTERVIEW_QUESTIONS.findIndex((q) => q.id === question?.id) + 1} / 3`}
              </p>
            </header>
            <div
              ref={threadRef}
              className="transcript-thread"
              aria-live="polite"
            >
              <div className="transcript-message agent">
                <span>유진 · 동행 인터뷰어</span>
                <p>
                  안녕하세요, {record.borrowerName || "사장"}님. 오늘은 점수보다
                  사업의 회복 이야기를 먼저 들을게요.
                </p>
              </div>
              {record.quests.some(Boolean) && (
                <details className="quest-context">
                  <summary>골목에서 남긴 세 가지 생각</summary>
                  {record.quests.map(
                    (q, i) =>
                      q && (
                        <p key={i}>
                          <strong>{QUEST_LABELS[i]}</strong> · {q}
                        </p>
                      ),
                  )}
                </details>
              )}
              {record.answers.map((item) => (
                <div key={item.questionId}>
                  <div className="transcript-message agent">
                    <span>유진의 질문</span>
                    <p>{item.questionText}</p>
                  </div>
                  <div className="transcript-message user">
                    <span>{record.borrowerName || "사장"}님</span>
                    <p>{item.answerText}</p>
                    <button
                      className="answer-edit"
                      onClick={() => {
                        setEditId(item.questionId);
                        setAnswer(item.answerText);
                        setChecked(false);
                      }}
                    >
                      이 답변 수정
                    </button>
                  </div>
                </div>
              ))}
              {question && (
                <div className="transcript-message agent current">
                  <span>{editId ? "답변 수정" : "유진의 질문"}</span>
                  <p>{question.question}</p>
                </div>
              )}
            </div>
            {question ? (
              <footer className="transcript-reply">
                <p>예시를 골라 수정하거나 직접 답해 주세요.</p>
                <div>
                  {question.options.map((option) => (
                    <button
                      key={option}
                      className={answer === option ? "selected" : ""}
                      onClick={() => setAnswer(option)}
                      aria-pressed={answer === option}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <label>
                  <span className="sr-only">직접 답변하기</span>
                  <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="직접 답변하기"
                    rows={3}
                    maxLength={3000}
                  />
                  <button onClick={sendAnswer} disabled={!answer.trim()}>
                    답변 저장
                  </button>
                </label>
                {editId && (
                  <button
                    className="answer-edit"
                    onClick={() => {
                      setEditId(null);
                      setAnswer("");
                    }}
                  >
                    수정 취소
                  </button>
                )}
              </footer>
            ) : (
              <footer className="interview-confirm">
                <p>
                  위의 질문과 답변을 다시 확인해 주세요. 완료하면 이 기록으로
                  결과를 정리합니다.
                </p>
                <label className="companion-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  답변 내용이 맞는지 확인했어요.
                </label>
                <button
                  className="companion-button"
                  disabled={!checked}
                  onClick={finish}
                >
                  인터뷰 완료하고 결과 보기 →
                </button>
              </footer>
            )}
          </aside>
        </section>
      )}
      {(saveError || unavailable) && (
        <p className="companion-error" role="alert">
          {saveError ||
            "브라우저 저장소를 사용할 수 없습니다. 저장 설정을 확인해 주세요."}
        </p>
      )}
      <p className="video-call-note">
        입력한 답변과 원문을 함께 보관합니다. 인터뷰 결과는 대출 승인·신용등급을
        뜻하지 않으며, 최종 판단은 금융기관이 합니다.
      </p>
      <MosaicCurtain mode="reveal" />
    </main>
  );
}
