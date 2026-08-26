"use client";

import { Activity, ChevronDown } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  REALTIME_LATENCY_SLO_MS,
  realtimeLatencyTelemetry,
  type RealtimeLatencyDistribution,
  type RealtimeLatencyHealth,
  type RealtimeLatencyPhase,
} from "@/realtime/latency-telemetry";

const HEALTH_LABELS: Record<RealtimeLatencyHealth, string> = {
  WAITING: "실시간 음성 연결 준비",
  ACTIVE: "말씀을 안전하게 처리하고 있어요",
  FAST: "빠르게 연결됨",
  DELAYED: "응답이 평소보다 조금 늦어요",
};

const PHASE_LABELS: Record<RealtimeLatencyPhase, string> = {
  speechToRecognized: "말끝 → 음성 인식",
  recognizedToAccepted: "음성 인식 → 답변 반영",
  acceptedToQuestionReady: "답변 반영 → 다음 질문",
  speechToQuestionReady: "말끝 → 다음 질문",
  ttsRequestToFirstByte: "음성 요청 → 첫 데이터",
  ttsFirstByteToPlayback: "첫 데이터 → 재생",
  ttsRequestToPlayback: "음성 요청 → 재생",
};

function formatLatency(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}초`;
}

function LatencyRow({
  phase,
  distribution,
}: {
  phase: RealtimeLatencyPhase;
  distribution: RealtimeLatencyDistribution;
}) {
  if (distribution.samples === 0) return null;
  return (
    <tr>
      <th scope="row">{PHASE_LABELS[phase]}</th>
      <td>{formatLatency(distribution.latestMs)}</td>
      <td>{formatLatency(distribution.p50Ms)}</td>
      <td>{formatLatency(distribution.p95Ms)}</td>
      <td>{formatLatency(REALTIME_LATENCY_SLO_MS[phase])}</td>
    </tr>
  );
}

/**
 * Borrower-facing text stays intentionally calm and non-technical. Exact
 * latency/provider data is available only inside the collapsed diagnostic
 * disclosure, so it can support a live demo without distracting the interview.
 */
export function RealtimeLatencyStatus() {
  const snapshot = useSyncExternalStore(
    realtimeLatencyTelemetry.subscribe,
    realtimeLatencyTelemetry.getSnapshot,
    realtimeLatencyTelemetry.getServerSnapshot,
  );
  const phaseEntries = Object.entries(snapshot.phases) as Array<[
    RealtimeLatencyPhase,
    RealtimeLatencyDistribution,
  ]>;
  const hasMetrics = phaseEntries.some(([, value]) => value.samples > 0);
  const providerSummary = [
    snapshot.providers.stt,
    snapshot.providers.ai && snapshot.providers.model
      ? `${snapshot.providers.ai} ${snapshot.providers.model}`
      : snapshot.providers.ai,
    snapshot.providers.tts,
  ].filter((value): value is string => Boolean(value));

  return (
    <section
      className="realtime-latency-status"
      data-health={snapshot.health.toLowerCase()}
      aria-label="실시간 음성 응답 상태"
    >
      <div className="realtime-latency-status__summary" role="status" aria-live="polite">
        <Activity size={15} aria-hidden="true" />
        <strong>{HEALTH_LABELS[snapshot.health]}</strong>
        {snapshot.health === "DELAYED" && (
          <span>답변은 그대로 유지되며 처리 완료 후 이어집니다.</span>
        )}
      </div>
      <details>
        <summary>
          응답 속도 진단
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="realtime-latency-status__details">
          {providerSummary.length > 0 && (
            <p>
              <strong>연결</strong> {providerSummary.join(" · ")}
            </p>
          )}
          {(snapshot.fallback.ai === true || snapshot.fallback.tts === true) && (
            <p className="realtime-latency-status__fallback">
              기본 연결 지연으로 안전 대체 경로를 사용했습니다.
            </p>
          )}
          {snapshot.slo.status !== "NO_DATA" && (
            <p className={snapshot.slo.status === "BREACHED" ? "realtime-latency-status__fallback" : undefined}>
              <strong>실시간 SLO</strong>{" "}
              {snapshot.slo.status === "MEETING"
                ? "현재 충족"
                : `${snapshot.slo.breachedPhases.map((phase) => PHASE_LABELS[phase]).join(", ")} 지연`}
            </p>
          )}
          {hasMetrics ? (
            <table>
              <thead>
                <tr>
                  <th>구간</th>
                  <th>최근</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>목표</th>
                </tr>
              </thead>
              <tbody>
                {phaseEntries.map(([phase, value]) => (
                  <LatencyRow key={phase} phase={phase} distribution={value} />
                ))}
              </tbody>
            </table>
          ) : (
            <p>첫 음성 턴이 끝나면 개인정보 없이 구간별 시간만 표시합니다.</p>
          )}
          <small>
            최근 음성 턴 {snapshot.turnSamples}개 · 음성 재생 {snapshot.ttsSamples}개만
            브라우저 메모리에 제한 보관합니다. 답변 원문과 오디오는 기록하지 않습니다.
          </small>
        </div>
      </details>
    </section>
  );
}
