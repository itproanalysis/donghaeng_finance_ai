import { Info } from "lucide-react";

import { formatPercent, type PillarView } from "@/components/api-adapter";

export interface PillarCoveragePreviewChange {
  key: PillarView["key"];
  label: string;
  previousConfirmationRate: number | null;
  currentConfirmationRate: number | null;
  previousEvaluableRate: number | null;
  currentEvaluableRate: number | null;
  changed: boolean;
}

/**
 * Copies the rates from two accepted server snapshots for display. No score,
 * rate, or business/credit assessment is calculated in the browser.
 */
export function comparePillarCoverageSnapshots(
  previous: readonly PillarView[],
  current: readonly PillarView[],
): PillarCoveragePreviewChange[] {
  const previousByKey = new Map(previous.map((pillar) => [pillar.key, pillar]));

  return current.flatMap((pillar) => {
    const before = previousByKey.get(pillar.key);
    if (!before) return [];

    return [{
      key: pillar.key,
      label: pillar.label,
      previousConfirmationRate: before.confirmationRate,
      currentConfirmationRate: pillar.confirmationRate,
      previousEvaluableRate: before.evaluableRate,
      currentEvaluableRate: pillar.evaluableRate,
      changed:
        before.confirmationRate !== pillar.confirmationRate ||
        before.evaluableRate !== pillar.evaluableRate,
    }];
  });
}

export function PillarCoveragePreview({
  pillars,
  changes,
  requiredInformationRate,
}: {
  pillars: readonly PillarView[];
  changes: readonly PillarCoveragePreviewChange[];
  requiredInformationRate: number | null;
}) {
  return (
    <article className="coverage-card">
      <div className="insight-heading">
        <div>
          <p className="panel-kicker">4 PILLAR PREVIEW</p>
          <h2>4대 축 PREVIEW 데이터 충분도</h2>
        </div>
        <strong>{formatPercent(requiredInformationRate)}</strong>
      </div>
      <div className="coverage-table" role="table" aria-label="영역별 데이터 충분도">
        <div className="coverage-table__head" role="row">
          <span role="columnheader">영역</span>
          <span role="columnheader">확인</span>
          <span role="columnheader">평가 가능</span>
        </div>
        {pillars.map((pillar) => (
          <div className="coverage-table__row" role="row" key={pillar.key}>
            <strong role="cell">{pillar.label}</strong>
            <span role="cell">{formatPercent(pillar.confirmationRate)}</span>
            <span role="cell">{formatPercent(pillar.evaluableRate)}</span>
          </div>
        ))}
      </div>

      <section
        className="pillar-preview-delta"
        aria-label="인터뷰 데이터 품질 PREVIEW 직전 서버 snapshot 변화"
      >
        <strong>인터뷰 데이터 품질 PREVIEW</strong>
        {changes.length > 0 ? (
          <ul>
            {changes.map((change) => (
              <li data-changed={change.changed ? "true" : undefined} key={change.key}>
                <b>{change.label}</b>
                <span>
                  확인률 {formatPercent(change.previousConfirmationRate)} →{" "}
                  {formatPercent(change.currentConfirmationRate)}
                </span>
                <span>
                  평가가능률 {formatPercent(change.previousEvaluableRate)} →{" "}
                  {formatPercent(change.currentEvaluableRate)}
                </span>
                <em>{change.changed ? "이번 턴 변화" : "이번 턴 변화 없음"}</em>
              </li>
            ))}
          </ul>
        ) : (
          <p>직전 서버 snapshot이 수신되면 4대 축별 확인률·평가가능률 변화를 표시합니다.</p>
        )}
      </section>

      <div className="summary-footnote">
        <Info size={15} aria-hidden="true" />
        수신된 서버 coverage 값의 직전→현재 비교이며 사업·신용·위험 점수가 아닙니다.
      </div>
    </article>
  );
}
