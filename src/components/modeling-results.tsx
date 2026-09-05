"use client";

import { useState } from "react";
import { ArrowRight, GitCompareArrows, Search } from "lucide-react";
import type { ModelingAxis, ModelingCase, ModelingValue } from "@/server/modeling-demo";
import styles from "@/app/modeling/modeling.module.css";

type AxisKey = "currentSituation" | "improvement";
const AXES: Array<{ key: AxisKey; label: string }> = [
  { key: "currentSituation", label: "현재 상황" },
  { key: "improvement", label: "개선가능성" },
];

export function ScoreAccounting({ axis }: { axis: ModelingAxis }) {
  const data = axis.accounting;
  return <div className={styles.accounting}>
    <span>산출식</span>
    <strong>{data.availablePoints ? `${data.earnedPoints} ÷ ${data.availablePoints} × 100 = ${Number(axis.score).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}` : "산출할 수 있는 항목 없음"}</strong>
    <span>산출 항목 {axis.itemsUsed}/{axis.itemsTotal} · {(data.coverageRatio * 100).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}%</span>
    {data.excludedItems.length > 0 && <small>제외: {data.excludedItems.join(" · ")}</small>}
  </div>;
}

/** Values, point contributions and comparison results come from Python artifacts.
 * Client interaction only selects and links those authoritative results. */
export function ModelingResults({ selectedCase, formatValue }: {
  selectedCase: ModelingCase;
  formatValue: (value: ModelingValue, code?: string) => string;
}) {
  const effect = selectedCase.modelingEffect;
  const [mode, setMode] = useState<"before" | "after">("after");
  const [filter, setFilter] = useState("");
  const [selectedFeature, setSelectedFeature] = useState("own_operating_day_drop_resolved_flag");
  const active = effect[mode].scorecard;
  const feature = selectedCase.features.find((row) => row.code === selectedFeature) ?? selectedCase.features[0];
  const conversion = selectedCase.interviewConversion.items.find((row) => row.feature === feature.code);
  const change = effect.changedFeatures.find((row) => row.feature === feature.code);
  const links = AXES.flatMap(({ key, label }) => active[key].items
    .filter((item) => item.lineage.some((lineage) => lineage.feature === feature.code))
    .map((item) => ({ key, label, item })));
  const visible = selectedCase.features.filter((row) => `${row.code} ${row.label}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return <div className={styles.resultReview}>
    <div className={styles.sectionTitle}><h2>평가 반영</h2><p>맥락 변수 포함 여부에 따른 점수와 평가항목의 변화를 비교합니다.</p></div>
    <p className={styles.experimentScope}>{effect.structuredInputsUnchanged ? "정형 변수 48개와 평가 규칙은 동일합니다." : "입력 차이 확인 필요"}</p>
    <div className={styles.resultModes} role="group" aria-label="평가에 반영할 데이터 선택">
      <button type="button" aria-pressed={mode === "before"} onClick={() => setMode("before")}>정형 데이터만</button>
      <button type="button" aria-pressed={mode === "after"} onClick={() => setMode("after")}>맥락 변수 결합</button>
    </div>

    <div className={styles.resultAxes} aria-live="polite">
      {AXES.map(({ key, label }) => <article key={key}>
        <header><div><span>{mode === "after" ? "맥락 변수 결합" : "정형 데이터만"}</span><h3>{label}</h3></div><strong>{formatValue(active[key].score)}<small> /100</small></strong></header>
        <ScoreAccounting axis={active[key]} />
        <div className={styles.contributionTrack} aria-label={`${label} 항목별 환산점 합계 ${formatValue(active[key].score)}`}>
          {active[key].items.map((item, index) => item.normalizedContribution === null ? null : <span key={item.name} data-part={index} style={{ width: `${item.normalizedContribution}%` }} title={`${item.name} ${formatValue(item.normalizedContribution)}점`} />)}
        </div>
        <ul className={styles.contributionLegend}>{active[key].items.map((item, index) => <li key={item.name}><i data-part={index} /><span>{item.name}</span><strong>{item.excluded ? "제외" : `${formatValue(item.normalizedContribution)}점`}</strong></li>)}</ul>
      </article>)}
    </div>

    <section className={styles.metricChanges} aria-labelledby="metric-change-title">
      <div className={styles.sectionHeading}><div><h2 id="metric-change-title">평가항목별 변동</h2></div><p>변수 {effect.changedFeatures.length}개 · 평가항목 {effect.changedScoreItems.length}개 변경</p></div>
      <div className={styles.metricTableWrap} tabIndex={0} aria-label="평가항목 전후 비교 표, 가로 스크롤 가능">
        <table className={styles.metricTable}><thead><tr><th>평가축 / 항목</th><th>정형 데이터만</th><th>맥락 변수 결합</th><th>반영된 결과</th></tr></thead><tbody>
          {AXES.flatMap(({ key, label }) => effect.after.scorecard[key].items.map((after, index) => {
            const before = effect.before.scorecard[key].items[index];
            const changed = before.points !== after.points || before.band !== after.band || before.excluded !== after.excluded;
            return <tr key={`${key}-${after.name}`} data-changed={changed}>
              <th scope="row"><small>{label}</small>{after.name}</th>
              <td><strong>{before.excluded ? "산출 제외" : `${before.points}/${before.maxPoints}`}</strong><small>{before.band}</small></td>
              <td><strong>{after.excluded ? "산출 제외" : `${after.points}/${after.maxPoints}`}</strong><small>{after.band}</small></td>
              <td>{changed ? before.excluded !== after.excluded ? "산출 대상 변경 · 분모 확인" : "평가 구간·배점 변경" : "동일"}</td>
            </tr>;
          }))}
        </tbody></table>
      </div>
      {!effect.after.interviewPresent && <p className={styles.boundaryNote}>이 사례에는 구조화된 인터뷰 입력이 없습니다. 입력을 추가한 것처럼 결과 차이를 만들지 않습니다.</p>}
    </section>

    <section className={styles.variableExplorer} aria-labelledby="variable-path-title">
      <div className={styles.sectionHeading}><div><h2 id="variable-path-title">변수별 반영 근거</h2></div><p>{mode === "after" ? "맥락 변수 결합" : "정형 데이터만"} 기준</p></div>
      <div className={styles.variableWorkspace}>
        <div className={styles.variableList}>
          <label><Search size={16} /><span className="sr-only">평가 경로 변수 검색</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="변수 이름·코드 검색" /></label>
          <p role="status">{visible.length} / 94개 변수</p>
          <div role="group" aria-label="평가 경로를 확인할 변수">{visible.map((row) => <button type="button" key={row.code} aria-pressed={row.code === feature.code} onClick={() => setSelectedFeature(row.code)}><strong>{row.label}</strong><small>{row.code}</small><span>{row.sourceLabel}</span></button>)}</div>
          {!visible.length && <p>일치하는 변수가 없습니다. 다른 이름으로 검색해 주세요.</p>}
        </div>
        <article className={styles.variableDetail} aria-live="polite">
          <span className={styles.eyebrow}>{feature.sourceLabel}</span><h3>{feature.label}</h3><details className={styles.technicalDetails}><summary>변수 코드·자료형</summary><code>{feature.code} · {feature.dtype}</code></details><p>{feature.description}</p>
          <div className={styles.variableValues}><div><span>정형 데이터만</span><strong>{formatValue(change ? change.before : feature.value, feature.code)}</strong></div><ArrowRight aria-hidden="true" /><div><span>맥락 변수 결합</span><strong>{formatValue(feature.value, feature.code)}</strong></div></div>
          {conversion?.evidenceText ? <blockquote><small>맥락 변수를 만든 원문 근거</small>“{conversion.evidenceText}”</blockquote> : <p className={styles.variableSourceNote}>{feature.source === "INTERVIEW" ? "연결된 원문 없음 · 값과 근거 상태를 별도로 확인합니다." : "금융 원천자료 또는 기존 변수에서 계산한 값입니다."}</p>}
          <h4>연결된 평가항목</h4>
          {links.length ? links.map(({ key, label, item }) => <div key={`${key}-${item.name}`} className={styles.variableMetric}><span>{label} → {item.name}</span><strong>{item.excluded ? "산출 제외" : `${item.points}/${item.maxPoints}`}</strong><p>{item.band}{item.note ? ` · ${item.note}` : ""}</p><small>함께 확인하는 값: {item.lineage.filter((row) => row.feature !== feature.code).map((row) => row.label).join(" · ") || "없음"}</small></div>) : <p className={styles.boundaryNote}>직접 연결된 평가항목이 없습니다. 추가 확인 또는 결합 변수의 재료로 사용될 수 있습니다.</p>}
        </article>
      </div>
    </section>

    <details className={styles.featureDeltaDisclosure}><summary><GitCompareArrows size={18} /> 결합 과정에서 달라진 변수 {effect.changedFeatures.length}개</summary><p>직접 연결은 평가 근거 목록 기준입니다. 결합 변수에 간접 반영되는 경우까지 개별 인과 기여도로 해석하지 않습니다.</p><div className={styles.metricTableWrap}><table className={styles.metricTable}><thead><tr><th>변수</th><th>반영 전</th><th>반영 후</th><th>직접 연결된 평가항목</th></tr></thead><tbody>{effect.changedFeatures.map((row) => <tr key={row.feature}><th scope="row">{row.label}<code>{row.feature}</code></th><td>{formatValue(row.before, row.feature)}</td><td>{formatValue(row.after, row.feature)}</td><td>{row.metricLinks.map((link) => link.item).join(" · ") || "직접 연결 없음"}</td></tr>)}</tbody></table></div></details>
  </div>;
}
