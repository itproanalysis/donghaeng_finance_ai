"use client";

import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowRight, Database, FileText, RefreshCw } from "lucide-react";
import { authenticatedFetch, formatInformationValue, readApiEnvelope } from "./api-adapter";
import { FEATURE_GROUP_LABELS, SIGNAL_LABELS, type DataReview, type ReviewFeature } from "@/domain/data-review";
import { DEV_V1_ALL_INFORMATION_CATALOG } from "@/domain/information-catalog";
import styles from "@/app/data-engine.module.css";

const infoLabel = (code: string) => DEV_V1_ALL_INFORMATION_CATALOG.find((item) => item.infoCode === code)?.label ?? code;
const valueText = (feature: ReviewFeature) => feature.value === null ? feature.state : typeof feature.value === "number"
  ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(feature.value)
  : String(feature.value);

export function DataReviewPanel({ interviewId, version, compact = false, onLoaded }: {
  interviewId: string; version?: number; compact?: boolean; onLoaded?: (review: DataReview) => void;
}) {
  const [review, setReview] = useState<DataReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/data-review`, { signal: controller.signal, cache: "no-store" })
      .then(readApiEnvelope).then((data) => { if (active) { setReview(data as DataReview); setError(null); onLoaded?.(data as DataReview); } })
      .catch((error: Error) => { if (active) setError(error.message || "변환 결과를 불러오지 못했습니다."); });
    return () => { active = false; controller.abort(); };
  }, [interviewId, version, retry, onLoaded]);
  return <section className={styles.review} aria-label="인터뷰 데이터 변환 결과">
    {error && <div className={styles.notice} role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}><RefreshCw size={14} /> 다시 불러오기</button>{review && <p>아래는 마지막으로 확인한 v{review.version} 기록입니다.</p>}</div>}
    {review ? <DataReviewContent review={review} compact={compact} /> : !error && <p role="status">서버에서 정보·Feature·근거를 불러오는 중입니다.</p>}
  </section>;
}

export function DataReviewContent({ review, compact = false }: { review: DataReview; compact?: boolean }) {
  const unique = useId().replace(/:/g, "");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState("fin_sales_avg_3m");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [focus, setFocus] = useState("trace");
  const { metrics } = review;
  const selected = review.features.find((item) => item.name === selectedName);
  const shown = review.features.filter((item) => (group === "all" || item.group === group) && (filter === "all" || item.state === filter)
    && `${item.name} ${item.definition.description}`.toLowerCase().includes(search.toLowerCase()));
  const linkedEvidence = review.evidence.filter((item) => review.features.some((feature) => feature.evidenceIds.includes(item.id)));
  const selectedEvidence = review.evidence.find((item) => item.id === evidenceId) ?? linkedEvidence.at(-1) ?? review.evidence.filter((item) => item.transcriptSegmentId).at(-1);
  const matchingInfo = review.canonical.filter((item) => selectedEvidence && item.selected?.evidenceIds.includes(selectedEvidence.id));
  const matchingFeatures = review.features.filter((item) => selectedEvidence && item.evidenceIds.includes(selectedEvidence.id));
  function inspect(name: string) { setSelectedName(name); setFocus("features"); }
  const sections = [["trace", "원문 → 구조화"], ["features", "Feature Explorer"], ["signals", "개선가능성 Signal"]];
  if (compact) return <><header className={styles.sectionTitle}><h2>실시간 데이터 생성</h2><span className={styles.status}>LIVE · v{review.version}</span></header><dl className={styles.metrics}>{[["현재 확인됨", metrics.confirmed], ["확인 필요", metrics.needed], ["근거 확보", metrics.evidence], ["Feature 생성", metrics.computed]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><details><summary>원문 → Canonical → Feature · 산식과 근거 펼치기</summary><DataReviewContent review={review} /></details></>;

  return <>
    <header className={styles.sectionTitle}><div><p className={styles.eyebrow}>Alternative Data Generation Engine</p><h2>말씀하신 내용이 데이터가 되는 과정</h2></div><span className={styles.status}>{review.snapshotType === "FINAL" ? "FINAL" : "LIVE"} · v{review.version}</span></header>
    <dl className={styles.metrics} aria-label="서버 정보 생성 현황" aria-live="polite">
      {[["현재 확인됨", metrics.confirmed], ["확인 필요", metrics.needed], ["근거 확보", metrics.evidence], ["Feature 생성", metrics.computed]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className={styles.small}>필수 정보 {metrics.resolvedRequired}/{metrics.totalRequired}개 정리 · 근거가 연결된 정보 {metrics.evidenceCovered}/{metrics.totalInformation}개</p>
    <div className={styles.missingness}><strong>현재 Feature 상태</strong><span>COMPUTED <b>{metrics.computed}</b></span><span>MISSING <b>{metrics.missing}</b></span><span>NOT CALCULABLE <b>{metrics.notCalculable}</b></span><p>알 수 없는 정보는 AI가 추정하지 않습니다. 누락은 0이 아니라 MISSING으로 남깁니다.</p></div>
    {!review.enabled && <p className={styles.notice}>Feature v2가 비활성화되어 있습니다. 원천 기록만 확인할 수 있습니다.</p>}
    {review.snapshotType === "FINAL" && <details className={styles.integrity}><summary>FINAL 보존 정보 · {review.featureArtifactOrigin === "FROZEN_FINAL" ? "종료 시점 Feature 고정" : "이전 버전 기록"}</summary><p>{review.featureArtifactOrigin === "FROZEN_FINAL" ? "원문·Canonical·Feature와 hash를 종료 시점에 함께 저장했습니다. 이후 실행기록은 이 원본을 변경하지 않습니다." : "기존 FINAL에는 v2가 저장되지 않아 보존된 Canonical에서 서버가 투영한 결과입니다. 원본 FINAL은 변경하지 않았습니다."}</p><code>{review.finalHash ?? "이전 형식: hash 표시 미지원"}</code></details>}
    <nav className={styles.tabs} aria-label="데이터 검증 단계">{sections.map(([id, label]) => <button key={id} aria-pressed={focus === id} onClick={() => setFocus(id)}>{label}</button>)}</nav>
    {focus === "trace" && <section className={styles.traceArea}>
      <div className={styles.traceSteps} key={review.version}>
        <article><span className={styles.eyebrow}>01 · ORIGINAL EVIDENCE</span><h3>사업자의 원문</h3>{selectedEvidence ? <><blockquote>{selectedEvidence.excerpt ?? selectedEvidence.originalText}</blockquote><small>Evidence #{review.evidence.indexOf(selectedEvidence) + 1} · {selectedEvidence.kind} · 인터뷰 진술</small><code>{selectedEvidence.id}</code>{selectedEvidence.originalText && <details><summary>전체 발화 보기</summary><p>{selectedEvidence.originalText}</p></details>}</> : <p>첫 답변을 보내면 실제 원문 Evidence가 여기에 연결됩니다.</p>}</article>
        <ArrowRight className={styles.flowArrow} aria-hidden="true" />
        <article><span className={styles.eyebrow}>02 · CANONICAL INFORMATION</span><h3>구조화된 정보</h3>{matchingInfo.length ? matchingInfo.map((item) => <div className={styles.traceItem} key={item.infoCode}><code>{item.infoCode}</code><strong>{formatInformationValue(item.selected?.value) ?? item.valueState}</strong><small>SOURCE: INTERVIEW · STATUS: {item.status}</small><small>Revision {item.selected?.revision} · {item.selected?.verification}</small></div>) : <p>선택한 원문에 연결된 확정 값이 없습니다. 상태와 선택 revision은 아래에서 확인합니다.</p>}</article>
        <ArrowRight className={styles.flowArrow} aria-hidden="true" />
        <article><span className={styles.eyebrow}>03 · FEATURE ENGINEERING</span><h3>서버가 변환한 Feature</h3>{matchingFeatures.length ? matchingFeatures.map((item) => <button className={styles.traceFeature} key={item.name} onClick={() => inspect(item.name)}><code>{item.name}</code><strong>{valueText(item)}</strong><small>산식·근거 보기 <ArrowRight size={12} /></small></button>) : <p>이 원문에서 계산할 수 있는 v2 Feature가 아직 없습니다. 임의로 값을 채우지 않습니다.</p>}</article>
      </div>
      <label className={styles.evidenceSelect}>다른 원문 따라가기<select value={selectedEvidence?.id ?? ""} onChange={(event) => setEvidenceId(event.target.value)}><option value="" disabled>원문 선택</option>{review.evidence.map((item, index) => <option key={item.id} value={item.id}>Evidence #{index + 1} · {infoLabel(item.infoCode)} · {(item.excerpt ?? "확인 기록").slice(0, 48)}</option>)}</select></label>
      <details className={styles.canonical} open={!compact}><summary>전체 Canonical Information · {review.canonical.length}개</summary><div className={styles.tableWrap}><table><thead><tr><th>항목</th><th>선택된 값</th><th>상태</th><th>근거</th></tr></thead><tbody>{review.canonical.map((item) => <tr key={item.infoCode}><th scope="row">{infoLabel(item.infoCode)}<code>{item.infoCode}</code></th><td>{formatInformationValue(item.selected?.value) ?? "MISSING"}<details><summary>Revision {item.selected?.revision ?? "없음"} · typed value</summary><pre>{JSON.stringify({ selectedRevisionId: item.selectedRevisionId, value: item.selected?.value ?? null, revisions: item.revisions }, null, 2)}</pre></details></td><td><span>{item.status}</span><small>{item.selected?.verification ?? "근거 없음"}</small></td><td>{item.selected?.evidenceIds.map((id) => <button className={styles.textButton} key={id} onClick={() => setEvidenceId(id)}>#{review.evidence.findIndex((entry) => entry.id === id) + 1} 원문</button>)}</td></tr>)}</tbody></table></div></details>
    </section>}
    {focus === "features" && <section aria-label="Feature Explorer" className={styles.explorer}>
      <div className={styles.filters}><label>그룹<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">전체 7개 그룹</option>{Object.entries(FEATURE_GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>상태<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체 상태</option>{["COMPUTED", "MISSING", "NOT_CALCULABLE"].map((state) => <option key={state}>{state}</option>)}</select></label><label>Feature 검색<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="fin_fixed_cost_ratio 또는 고정비" /></label></div>
      <div className={styles.explorerColumns}><div className={styles.featureList}><p>{shown.length} / {metrics.totalFeatures}개 · {review.schemaVersion}</p>{shown.map((item) => <button key={item.name} className={styles.featureRow} aria-pressed={selectedName === item.name} onClick={() => setSelectedName(item.name)}><span>{item.definition.description}<code>{item.name}</code></span><strong data-state={item.state}>{valueText(item)}</strong></button>)}{shown.length === 0 && <p>조건에 맞는 Feature가 없습니다.</p>}</div>
        {selected && <article className={styles.inspector} aria-label={`${selected.name} 상세`}><span className={styles.eyebrow}>{FEATURE_GROUP_LABELS[selected.group]}</span><h3>{selected.definition.description}</h3><code>{selected.name}</code><dl><div><dt>Value · {selected.state}</dt><dd>{valueText(selected)}</dd></div><div><dt>Source</dt><dd>{selected.traces.length ? [...new Set(selected.traces.map((item) => item.infoCode))].join(", ") : selected.definition.source}<small>{selected.traces.length ? "실제 연결: INTERVIEW / SELF_REPORTED. 사전의 금융 원천 분류와 구분합니다." : "현재 연결된 원천이 없으면 값은 MISSING입니다."}</small></dd></div><div><dt>Calculation</dt><dd><code>{selected.calculation ?? "직접 원천값 또는 원천 미연결"}</code><p>{selected.reason}</p></dd></div><div><dt>Window</dt><dd>{selected.definition.window ?? "지정 없음"}</dd></div><div><dt>Missing Policy</dt><dd>{selected.definition.missingPolicy}</dd></div><div><dt>Version / Model Candidate</dt><dd>{selected.version} / false<small>현재 모델 학습·대출 판단에 투입하지 않습니다.</small></dd></div></dl>
          <h4>Feature → Canonical → Evidence</h4>{selected.traces.length ? selected.traces.map((trace, index) => <div key={index} className={styles.lineage}><div>{trace.featureNames.map((name) => <button key={name} className={styles.textButton} onClick={() => setSelectedName(name)}>{name} →</button>)}</div><code>{trace.infoCode}</code><small>Revision ID: {trace.revisionId ?? "없음"}</small>{trace.evidenceIds.map((id) => { const item = review.evidence.find((entry) => entry.id === id); return <details key={id} open><summary>Evidence #{review.evidence.findIndex((entry) => entry.id === id) + 1} · {item?.kind}</summary><blockquote>{item?.excerpt ?? item?.originalText ?? "연결된 원문 없음"}</blockquote>{item?.originalText && item.originalText !== item.excerpt && <details><summary>전체 발화 보기</summary><p>{item.originalText}</p></details>}<code>{id}</code></details>; })}</div>) : <p>추적할 원천 Evidence가 없습니다. 값이나 원문을 추정하지 않습니다.</p>}
        </article>}
      </div>
    </section>}
    {focus === "signals" && <section aria-label="Improvement Signals"><p className={styles.notice}>회복·실행을 검토하는 관측 신호입니다. 입력이 일부만 있어도 계산되는 기존 산식을 사용하므로, 값의 크기를 근거의 강도나 성공 확률로 읽지 마세요.</p><div className={styles.signals}>{Object.entries(SIGNAL_LABELS).map(([name, label]) => {
      const feature = review.features.find((item) => item.name === name);
      if (!feature) return <article key={name}><h3>{label}</h3><p>이 snapshot에는 해당 artifact가 없습니다.</p></article>;
      return <article key={name}><div className={styles.signalHeading}><h3>{label}</h3><span>{feature.interpretation}</span></div><code>{name}</code><p>{feature.reason}</p><p>확인된 계산 입력 {feature.sourceFeatures.filter((source) => source !== name).length} / {feature.expectedInputs.length}개</p><details><summary>왜? · 원천과 제약 확인</summary><h4>사용한 입력</h4>{feature.sourceFeatures.filter((source) => source !== name).map((source) => <button key={source} className={styles.textButton} onClick={() => inspect(source)}>{review.features.find((item) => item.name === source)?.definition.description ?? source} →</button>)}{feature.state !== "COMPUTED" && <p>계산에 쓸 값이 없습니다.</p>}<h4>정보의 제약</h4>{feature.missingInputs.length ? <ul>{feature.missingInputs.map((source) => <li key={source}>{review.features.find((item) => item.name === source)?.definition.description ?? source} · MISSING</li>)}</ul> : <p>계산 입력은 확보되었으나 자기보고의 진위·실제 성과는 별도 검토가 필요합니다.</p>}<p>원문 Evidence {feature.evidenceIds.length}개 연결</p><button className={styles.textButton} onClick={() => inspect(name)}>Feature와 연결 원문 전체 보기 <ArrowRight size={13} /></button><p className={styles.small}>서버 원시값: {valueText(feature)} · {feature.state}. 관측된 입력에 대한 규칙 값이며 신용점수가 아닙니다.</p>{name === "imp_plan_specificity" || name === "imp_plan_feasibility" ? <p className={styles.small}>현재 산식은 확보된 입력만 분모에 포함합니다. 원시값 1도 계획이 완전하거나 실행에 성공한다는 뜻이 아닙니다.</p> : null}</details></article>;
    })}</div></section>}
    <footer className={styles.panelFooter} id={`${unique}-boundary`}><Database size={15} /><span>서버: Canonical · Evidence · Feature · 상태 전이</span><ArrowDown size={14} /><FileText size={15} /><span>사람: 추가 확인과 금융기관 최종 판단</span></footer>
  </>;
}
