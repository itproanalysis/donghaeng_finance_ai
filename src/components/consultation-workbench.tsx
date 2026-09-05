"use client";

import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  Landmark,
  Save,
  Sprout,
} from "lucide-react";
import { useRef, useState } from "react";
import { CONSULTATION_DOCUMENTS, CONSULTATION_OWNERS, CONSULTATION_PERIODS } from "@/domain/consultation-draft";
import { useConsultationDraft } from "@/components/use-consultation-draft";

export interface ConsultationProposal {
  id: string;
  title: string;
  reason: string;
  action: string;
  source: string;
}
export interface ConsultationFact {
  label: string;
  value: string;
  status?: string;
}

const INSTITUTIONS = [
  {
    id: "semas",
    name: "소상공인시장진흥공단",
    category: "소상공인 지원·정책자금 상담",
    url: "https://www.semas.or.kr/",
    description:
      "사업 목적에 맞는 지원사업과 정책자금의 공고·상담 경로를 확인합니다.",
  },
  {
    id: "koreg",
    name: "지역신용보증재단",
    category: "지역별 보증 상담",
    url: "https://www.koreg.or.kr/",
    description:
      "신용보증재단중앙회에서 사업장 소재지의 재단과 보증 상담 경로를 확인합니다.",
  },
  {
    id: "kodit",
    name: "신용보증기금",
    category: "기업 보증·경영지원 상담",
    url: "https://www.kodit.or.kr/",
    description:
      "보증과 경영지원 제도를 확인하고 담당 기관과 상담 범위를 검토합니다.",
  },
] as const;
const DOCUMENTS = CONSULTATION_DOCUMENTS;

export function ConsultationWorkbench({
  businessName,
  facts,
  proposals,
  sourceId,
  interviewId,
  demo = false,
  onStageChange,
}: {
  businessName: string;
  facts: readonly ConsultationFact[];
  proposals: readonly ConsultationProposal[];
  sourceId: string;
  interviewId?: string;
  demo?: boolean;
  onStageChange?: (stage: number) => void;
}) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLElement>(null);
  function changeStep(next: number) {
    setStep(next);
    onStageChange?.(next);
    requestAnimationFrame(() =>
      headingRef.current?.scrollIntoView({ block: "start", behavior: "auto" }),
    );
  }
  const persistence = useConsultationDraft(demo ? undefined : interviewId);
  const { draft, setDraft } = persistence;
  const { proposalId, owner, period, documents, reviewed, institutionId } = draft;
  const [notice, setNotice] = useState("");
  const selected = proposals.find((p) => p.id === proposalId);
  const institution = INSTITUTIONS.find((i) => i.id === institutionId);
  const ready = !!selected && reviewed && documents.length === DOCUMENTS.length;
  const visibleStep = !selected ? 0 : step === 2 && !ready ? 1 : step;
  function download() {
    if (!institution || !ready || !selected) return;
    const report = [
      "동행금융 · 금융기관 상담 준비자료",
      demo ? "가상 사례 · 서비스 체험용" : "담당자 작성 초안 · 기관 미전송",
      `사업체: ${businessName}`,
      `출처: ${sourceId}`,
      "",
      "1. 인터뷰에서 정리한 현황",
      ...facts.map(
        (f) => `- ${f.label}: ${f.value}${f.status ? ` (${f.status})` : ""}`,
      ),
      "",
      "2. 제안 단계의 개선안",
      selected.title,
      `근거: ${selected.reason}`,
      `출처: ${selected.source}`,
      `실행: ${selected.action}`,
      `담당: ${owner}`,
      `점검: ${period}`,
      "실행 성과는 아직 확인되지 않았습니다.",
      "",
      "3. 준비자료 점검",
      ...documents.map((d) => `- ${d}`),
      "",
      "4. 상담 검토 기관",
      institution.name,
      institution.url,
      "",
      "공식 증빙 원본은 별도로 준비해야 합니다. 이 자료는 증빙을 대체하지 않습니다.",
      "기관에 전송하거나 신청한 자료가 아닙니다. 제3자 제공 전 별도 동의와 담당자 확인이 필요합니다.",
      "대출 승인·한도·금리·신용등급을 판단하지 않으며 상담 가능 여부는 해당 기관이 확인합니다.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff", report], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `동행_상담준비자료_${demo ? "체험" : "초안"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "상담 준비자료를 내려받았습니다. 금융기관에는 전송되지 않았습니다.",
    );
  }

  return (
    <section
      ref={headingRef}
      className="consultation-workbench dh-panel"
      id="consultation"
    >
      <header className="dh-section-heading">
        <div>
          <span className="dh-eyebrow">담당자 작성</span>
          <h2>상담 준비서</h2>
          <p>
            {demo
              ? "가상 사례의 개선안과 상담 준비를 체험합니다."
              : "개선안과 준비자료를 확인해 초안으로 저장합니다."}
          </p>
        </div>
        <span className="dh-tag">{demo ? "체험 초안" : "기관 미전송"}</span>
      </header>
      {!demo && interviewId && <div className="draft-savebar">
        <div role="status"><strong>{persistence.loading ? "저장된 초안 확인 중" : persistence.saving ? "초안 저장 중" : !persistence.loaded ? "초안 연결 확인 필요" : persistence.dirty ? "저장하지 않은 변경 내용" : persistence.updatedAt ? "초안 저장됨" : "새 상담 초안"}</strong><small>{persistence.updatedAt ? `마지막 저장 ${new Date(persistence.updatedAt).toLocaleString("ko-KR")} · 버전 ${persistence.revision}` : "수정 후 ‘초안 저장’을 눌러 주세요. 최종 인터뷰·평가 원본은 바뀌지 않습니다."}</small></div>
        <button className="dh-button dh-button--light" type="button" disabled={persistence.loading || persistence.saving} onClick={() => void persistence.reload()}>최신 초안 불러오기</button>
        <button className="dh-button" type="button" disabled={persistence.loading || persistence.saving || !persistence.loaded || !persistence.dirty} onClick={() => void persistence.save()}><Save size={17} />{persistence.saving ? "저장 중" : "초안 저장"}</button>
      </div>}
      {persistence.error && <p className="form-error" role="alert">{persistence.error} 현재 수정 내용은 저장 성공 전까지 이 화면에만 남습니다.</p>}
      {proposalId && !selected && <p className="form-error" role="status">저장된 개선안이 현재 후보에 없습니다. 아래에서 근거를 확인하고 개선안을 다시 선택해 주세요.</p>}
      <fieldset className="workbench-fields" disabled={persistence.loading || persistence.saving || !persistence.loaded}>
      <legend className="sr-only">상담 초안 작성</legend>
      <nav className="workbench-tabs" aria-label="상담 준비 단계">
        {["개선 제안", "실행·자료 점검", "기관 상담 준비"].map((title, i) => (
          <button
            key={title}
            type="button"
            aria-current={visibleStep === i ? "step" : undefined}
            data-active={visibleStep === i}
            disabled={(i > 0 && !selected) || (i === 2 && !ready)}
            onClick={() => changeStep(i)}
          >
            <span>0{i + 1}</span>
            {title}
          </button>
        ))}
      </nav>
      {visibleStep === 0 && (
        <>
          <p>
            인터뷰 근거를 읽고 함께 검토할 개선안을 선택하세요. 선택만으로
            목표가 확정되지는 않습니다.
          </p>
          <div className="proposal-grid">
            {proposals.map((p) => (
              <button
                className="proposal-card"
                type="button"
                key={p.id}
                aria-pressed={p.id === proposalId}
                data-selected={p.id === proposalId}
                onClick={() => {
                  setDraft((current) => ({ ...current, proposalId: p.id, reviewed: false }));
                  onStageChange?.(0);
                }}
              >
                <Sprout size={23} />
                <h3>{p.title}</h3>
                <p>{p.reason}</p>
                <div>
                  <strong>실행 후보</strong>
                  <p>{p.action}</p>
                </div>
                <small>근거: {p.source}</small>
                <span>
                  {p.id === proposalId ? (
                    <>
                      <CheckCircle2 size={16} /> 선택됨
                    </>
                  ) : (
                    "이 개선안 검토하기"
                  )}
                </span>
              </button>
            ))}
          </div>
          {proposals.length === 0 && (
            <p>
              연결된 근거가 부족합니다. 인터뷰 상세에서 정보를 확인한 뒤
              개선안을 준비하세요.
            </p>
          )}
          <div className="workbench-actions">
            <button
              className="dh-button"
              disabled={!selected}
              onClick={() => changeStep(1)}
            >
              실행·자료 점검 <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
      {visibleStep === 1 && selected && (
        <div className="dh-two-columns">
          <div>
            <span className="dh-icon dh-icon--teal">
              <FileCheck2 size={24} />
            </span>
            <h3>{selected.title}</h3>
            <p>{selected.action}</p>
            <div className="dh-form-row">
              <label>
                함께 점검할 담당자
                <select
                  value={owner}
                  onChange={(e) => {
                    setDraft((current) => ({ ...current, owner: e.target.value, reviewed: false }));
                  }}
                >
                  {CONSULTATION_OWNERS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label>
                다음 점검 시점
                <select
                  value={period}
                  onChange={(e) => {
                    setDraft((current) => ({ ...current, period: e.target.value, reviewed: false }));
                  }}
                >
                  {CONSULTATION_PERIODS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <label className="dh-checkbox">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setDraft((current) => ({ ...current, reviewed: e.target.checked }))}
              />
              <span>
                제안 내용과 점검 계획을 검토했습니다.
                <small>실제 실행·달성 여부를 확인한 것은 아닙니다.</small>
              </span>
            </label>
          </div>
          <div className="document-checklist">
            <h3>상담 전에 확인할 자료</h3>
            <p>
              {demo
                ? "아래는 준비자료 점검을 체험하는 체크리스트입니다."
                : "실제로 확인한 자료만 체크하세요. 증빙은 이 화면에 업로드되지 않습니다."}
            </p>
            {DOCUMENTS.map((d) => (
              <label className="dh-checkbox" key={d}>
                <input
                  type="checkbox"
                  checked={documents.includes(d)}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, documents: DOCUMENTS.filter((item) => item === d ? e.target.checked : current.documents.includes(item)) }))
                  }
                />
                {d}
              </label>
            ))}
            <div className="workbench-actions">
              <span>{documents.length} / 4 확인</span>
              <button
                className="dh-button"
                disabled={!ready}
                onClick={() => changeStep(2)}
              >
                기관 상담 준비 <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
      {visibleStep === 2 && (
        <>
          <div className="dh-inline-note">
            <Landmark size={20} />
            <span>
              필요한 상담 경로를 선택하세요. 아래는 연계 준비를 위한 공식 안내
              채널이며 제휴·접수·승인을 의미하지 않습니다.
            </span>
          </div>
          <div className="institution-grid">
            {INSTITUTIONS.map((i) => (
              <article
                className="institution-card"
                data-selected={institutionId === i.id}
                key={i.id}
              >
                <small>{i.category}</small>
                <h3>{i.name}</h3>
                <p>{i.description}</p>
                <a href={i.url} target="_blank" rel="noopener noreferrer">
                  공식 안내 확인 <ExternalLink size={14} />
                </a>
                <button
                  className="dh-button dh-button--light"
                  aria-pressed={institutionId === i.id}
                  onClick={() => {
                    setDraft((current) => ({ ...current, institutionId: i.id }));
                    setNotice("");
                  }}
                >
                  {institutionId === i.id
                    ? "상담 검토 기관으로 선택됨"
                    : "상담 검토 기관으로 선택"}
                </button>
              </article>
            ))}
          </div>
          <div className="consultation-handoff">
            <div>
              <span className="dh-tag">상담 준비 단계</span>
              <h3>
                {institution
                  ? `${institution.name} 상담 준비자료`
                  : "상담 검토 기관을 선택해 주세요"}
              </h3>
              <p>
                현황·근거·개선안·점검 계획을 한 자료로 정리합니다.
                <br />
                실제 신청·개인정보 전송은 별도의 확인 절차가 필요합니다.
              </p>
            </div>
            <button
              className="dh-button"
              disabled={!institution || !ready}
              onClick={download}
            >
              <Download size={17} /> 상담 준비자료 내려받기
            </button>
          </div>
        </>
      )}
      </fieldset>
      {notice && (
        <p className="dh-success" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </p>
      )}
    </section>
  );
}
