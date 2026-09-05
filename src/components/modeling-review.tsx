"use client";

import {
  ArrowRight,
  Banknote,
  BookOpenCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Database,
  GitCompareArrows,
  ListFilter,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type {
  ModelingBundle,
  ModelingCase,
  ModelingFeature,
  ModelingScoreItem,
  ModelingValue,
} from "@/server/modeling-demo";

import styles from "@/app/modeling/modeling.module.css";
import { ModelingResults, ScoreAccounting } from "@/components/modeling-results";
import { ModelingWorkflow } from "@/components/modeling-workflow";

type ModelingTab = "summary" | "data" | "features" | "impact" | "score" | "cb" | "goals" | "reevaluation" | "report";

const TABS: Array<{ id: ModelingTab; number: string; label: string }> = [
  { id: "summary", number: "01", label: "요약" },
  { id: "data", number: "02", label: "원천자료" },
  { id: "features", number: "03", label: "변수" },
  { id: "impact", number: "04", label: "평가 반영" },
  { id: "score", number: "05", label: "평가기준" },
  { id: "cb", number: "06", label: "신용정보" },
  { id: "goals", number: "07", label: "목표·기록" },
  { id: "reevaluation", number: "08", label: "재평가" },
  { id: "report", number: "09", label: "검토 요약" },
];

const PIPELINE = [
  ["원천 데이터", "5개 정형 소스"],
  ["변화 탐지", "6개 질문 규칙"],
  ["추가 확인", "변화 이유·계획"],
  ["변수화", "인터뷰 30개"],
  ["결합 분석", "새 신호 16개"],
  ["분석 변수", "총 94개"],
  ["두 축 평가", "각 5개 규칙"],
  ["CB·재평가", "맥락과 변화 추적"],
] as const;

const INTERVIEW_GROUPS = [
  {
    title: "데이터 기반 추가 확인",
    codes: [
      "own_operating_day_drop_reason",
      "own_operating_day_drop_resolved_flag",
      "own_fixed_cost_increase_reason",
      "own_low_balance_coping_method",
      "own_purchase_increase_reason",
      "ops_platform_fee_ratio",
      "biz_hall_customer_decline_flag",
    ],
  },
  {
    title: "미래 상황 · 사업 맥락",
    codes: [
      "own_confirmed_order_value",
      "own_booking_coverage_weeks",
      "own_confirmed_order_deposit_flag",
      "own_seasonality_direction",
      "own_peak_months",
      "own_essential_expense",
      "own_buffer_months",
      "own_primary_problem",
      "ops_repeat_customer_ratio",
    ],
  },
  {
    title: "목표 · 실행 계획",
    codes: [
      "own_goal_evidence_feature",
      "own_goal_target_value",
      "own_goal_horizon_days",
      "own_goal_self_selected_flag",
      "own_plan_action_category",
      "own_plan_horizon_days",
      "own_plan_budget",
      "own_plan_blockers",
      "own_plan_top_blocker",
      "own_prior_action_type",
      "own_prior_action_result",
      "own_prior_action_ongoing_flag",
      "own_fund_purpose",
      "own_fund_amount",
    ],
  },
] as const;

const STATUS_LABELS: Record<string, string> = {
  VALUE: "값 있음",
  MISSING: "미확인",
  REFUSED: "답변 거절",
  NOT_APPLICABLE: "해당 없음",
  UNDECIDED: "미결정",
};

const ROLE_LABELS: Record<string, string> = {
  SCORE: "평가 사용",
  DERIVED: "결합 산출",
  CONTEXT: "맥락 참고",
  QUESTION_TRIGGER: "질문 발생",
  NOT_USED: "직접 미사용",
  CONTEXT_ONLY: "맥락 전용",
};

const PERCENT_PATTERN = /(ratio|growth|change|share|cv|recovery|drawdown|consistency|headroom|percentile|probability)/i;
const DAY_PATTERN = /(day_count|horizon_days|buffer_days)/i;

function isState(value: ModelingValue): value is string {
  return typeof value === "string" && Object.hasOwn(STATUS_LABELS, value);
}

function formatValue(value: ModelingValue, code = ""): string {
  if (isState(value)) return STATUS_LABELS[value];
  if (code === "sales_drop_driver" && typeof value === "string") {
    return ({ count: "손님·거래건수 감소", ticket: "객단가 하락", operating_day: "영업일 감소" } as Record<string, string>)[value] ?? value;
  }
  if (value === null) return "값 없음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number") {
    if (PERCENT_PATTERN.test(code)) return `${(value * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
    if (DAY_PATTERN.test(code)) return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일`;
    return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  }
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") {
    const composed = value as { value?: ModelingValue; materials_used?: ModelingValue };
    if (composed.value !== undefined) {
      return `${formatValue(composed.value, code)} · 재료 ${formatValue(composed.materials_used ?? 0)}개`;
    }
    return JSON.stringify(value);
  }
  return value;
}

function formatScore(value: ModelingValue): string {
  return typeof value === "number" ? value.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : formatValue(value);
}

function thresholdLabel(operator: string, value: number, feature: string): string {
  const symbol = {
    LESS_THAN_OR_EQUAL: "≤",
    GREATER_THAN_OR_EQUAL: "≥",
    ABS_GREATER_THAN_OR_EQUAL: "절댓값 ≥",
  }[operator] ?? operator;
  return `${symbol} ${formatValue(value, feature)}`;
}

interface ModelingReviewProps {
  selectedCase: ModelingCase;
  caseOptions: Array<{
    caseId: string;
    ordinal: number;
    title: string;
    verificationPurpose: string;
    currentSituation: ModelingValue;
    improvement: ModelingValue;
  }>;
  model: ModelingBundle["model"];
  comparisons: ModelingBundle["comparisons"];
  reevaluation: ModelingBundle["reevaluation"];
  validation: ModelingBundle["validation"];
  allCases?: ModelingCase[];
}

export function ModelingReview({
  selectedCase,
  caseOptions,
  model,
  comparisons,
  reevaluation,
  validation,
  allCases,
}: ModelingReviewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: ModelingTab = TABS.find((tab) => tab.id === requestedTab)?.id ?? "summary";
  const [shareStatus, setShareStatus] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  function setActiveTab(tab: ModelingTab) {
    if (tab === "report" && activeTab === "reevaluation" && selectedCase.caseId === reevaluation.beforeCase) {
      selectCase(reevaluation.afterCase, "report");
      return;
    }
    const query = new URLSearchParams(window.location.search);
    query.set("case", selectedCase.caseId);
    query.set("tab", tab);
    window.history.pushState(null, "", `/modeling?${query.toString()}`);
    setSelectedItem(null);
    setShareStatus("");
    setShareFallback("");
  }
  function selectCase(caseId: string, tab: ModelingTab = activeTab) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("case", caseId);
    query.set("tab", tab);
    setSelectedItem(null);
    beginCaseTransition(() => router.push(`/modeling?${query.toString()}`, { scroll: false }));
  }
  async function copyViewLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("case", selectedCase.caseId);
    url.searchParams.set("tab", activeTab);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareFallback("");
      setShareStatus("사례와 선택한 탭의 링크를 복사했습니다.");
    } catch {
      setShareFallback(url.toString());
      setShareStatus("아래 주소를 선택해 복사해 주세요.");
    }
  }
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<ModelingScoreItem | null>(null);
  const [changingCase, beginCaseTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lineageTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeLineage = useCallback(() => {
    setSelectedItem(null);
    window.setTimeout(() => lineageTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeLineage();
      if (event.key === "Tab") {
        const targets = document.getElementById("modeling-lineage-dialog")?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!targets?.length) return;
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeLineage, selectedItem]);

  const featureByCode = useMemo(
    () => new Map(selectedCase.features.map((feature) => [feature.code, feature])),
    [selectedCase.features],
  );

  const visibleFeatures = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return selectedCase.features.filter((feature) => {
      if (sourceFilter !== "ALL" && feature.source !== sourceFilter) return false;
      if (statusFilter !== "ALL" && feature.status !== statusFilter) return false;
      if (roleFilter !== "ALL" && !feature.roles.includes(roleFilter)) return false;
      if (!normalized) return true;
      return [feature.code, feature.label, feature.description, feature.sourceLabel]
        .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized));
    });
  }, [query, roleFilter, selectedCase.features, sourceFilter, statusFilter]);

  const firedTriggers = selectedCase.triggers.filter((item) => item.fired);
  const missingTotal = selectedCase.featureSummary.total - selectedCase.featureSummary.valueCount;
  const salesDirection = selectedCase.scorecard.improvement.items.find((item) => item.name === "매출 방향");
  const salesDriver = salesDirection?.lineage.find((item) => item.feature === "sales_drop_driver");
  const combinedFeatures = selectedCase.features.filter((item) => item.source === "COMBINED");
  const selectedSourceFeatures = selectedCase.features.filter((item) => item.source === sourceFilter);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + direction + TABS.length) % TABS.length;
    setActiveTab(TABS[next].id);
    document.getElementById(`modeling-tab-${TABS[next].id}`)?.focus();
  };

  const openLineage = (event: MouseEvent<HTMLButtonElement>, item: ModelingScoreItem) => {
    lineageTriggerRef.current = event.currentTarget;
    setSelectedItem(item);
  };

  return (
    <main id="main-content" className={styles.page}>
      <section className={styles.hero} aria-labelledby="modeling-heading">
        <div className={styles.heroCopy}>
          <h1 id="modeling-heading">사업·행동 평가</h1>
          <p className={styles.lead}>사업 현황을 변수로 정리하고, 목표 수행에 따른 변화를 다시 평가합니다.</p>
          <div className={styles.heroActions}>
            <Link href="/about">서비스 소개</Link><span>합성 사례 · 규칙 기반 평가</span>
          </div>
        </div>
        <aside className={styles.casePicker} aria-label="검증 사례 선택">
          <label htmlFor="modeling-case">분석 사례 ({caseOptions.length}개)</label>
          <select
            id="modeling-case"
            value={selectedCase.caseId}
            disabled={changingCase}
            onChange={(event) => {
              const next = event.target.value;
              selectCase(next);
            }}
          >
            {caseOptions.map((item) => <option value={item.caseId} key={item.caseId}>{item.ordinal}. {item.title}</option>)}
          </select>
          {changingCase && <p role="status">사례를 불러오는 중…</p>}
        </aside>
      </section>

      <nav className={styles.serviceJourney} aria-label="평가와 후속 검토 흐름">
        {([
          { label: "자료·CB 확인", tab: "data", tabs: ["data", "cb"] },
          { label: "변수·평가", tab: "impact", tabs: ["summary", "features", "impact", "score"] },
          { label: "목표·수행기록", tab: "goals", tabs: ["goals"] },
          { label: "재평가", tab: "reevaluation", tabs: ["reevaluation"] },
          { label: "기관 검토 준비", tab: "report", tabs: ["report"] },
        ] as const).map((step, index) => <button type="button" key={step.tab} aria-current={(step.tabs as readonly string[]).includes(activeTab) ? "step" : undefined} onClick={() => setActiveTab(step.tab)}><span>{index + 1}</span>{step.label}</button>)}
      </nav>

      <nav className={styles.tabs} role="tablist" aria-label="분석 결과 항목">
        {TABS.map((tab, index) => (
          <button
            id={`modeling-tab-${tab.id}`}
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="modeling-content"
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={styles.reviewTools}>
        <span>{selectedCase.title}</span>
        <div><button type="button" onClick={() => void copyViewLink()}><Copy size={16} /> 이 화면 링크 복사</button><a href={`/api/demo/modeling/${encodeURIComponent(selectedCase.caseId)}`} download={`${selectedCase.caseId}-evidence.json`}><Download size={16} /> 근거 데이터 받기</a></div>
        <span role="status" aria-live="polite">{shareStatus}</span>
        {shareFallback && <input aria-label="현재 분석 화면 주소" readOnly value={shareFallback} onFocus={(event) => event.currentTarget.select()} />}
      </div>

      <section
        id="modeling-content"
        className={styles.content}
        role="tabpanel"
        aria-labelledby={`modeling-tab-${activeTab}`}
        tabIndex={-1}
      >
        {activeTab === "summary" ? (
          <>
            <SectionTitle eyebrow="모델 결과" title="분석 요약" description="평가항목을 누르면 적용한 값과 배점을 확인할 수 있습니다." />
            <div className={styles.axisSummaryGrid}>
              <AxisSummary axis={selectedCase.scorecard.currentSituation} title="현재 상황" description="현금흐름·잔액·상환 부담" tone="navy" onOpen={openLineage} />
              <AxisSummary axis={selectedCase.scorecard.improvement} title="개선가능성" description="매출 변화·회복 신호·계획" tone="green" onOpen={openLineage} />
            </div>
            <div className={styles.resultEntry}><p>맥락 변수 결합 전후의 배점과 산출 항목을 비교할 수 있습니다.</p><button type="button" onClick={() => setActiveTab("impact")}>평가 반영 비교 <ArrowRight size={17} /></button></div>
            <SameDeclineComparison comparison={comparisons.sameSalesDecline} selectedCaseId={selectedCase.caseId} onSelectCase={selectCase} allCases={allCases} />

            <div className={styles.insightGrid}>
              <article className={styles.paperCard}>
                <span className={styles.cardKicker}>매출 방향</span>
                <h3>{salesDirection?.band ?? "평가 재료 확인 필요"}</h3>
                <p>{salesDirection?.note || "점수 항목 상세에서 실제 사용 변수를 확인할 수 있습니다."}</p>
                <dl className={styles.compactFacts}>
                  <div><dt>감소 원인</dt><dd>{salesDriver ? formatValue(salesDriver.value, salesDriver.feature) : "분해 불가"}</dd></div>
                  <div><dt>발생 질문</dt><dd>{firedTriggers.length} / {selectedCase.triggers.length}</dd></div>
                </dl>
              </article>
              <article className={styles.paperCard}>
                <span className={styles.cardKicker}>자료 상태</span>
                <h3>미확인·해당 없음 등 {missingTotal}개</h3>
                <p>상태별로 구분해 보관하며, 계산 불가 항목은 산출에서 제외합니다.</p>
                <dl className={styles.compactFacts}>
                  {Object.entries(selectedCase.featureSummary.statusCounts).filter(([key]) => key !== "VALUE").map(([key, value]) => (
                    <div key={key}><dt>{STATUS_LABELS[key] ?? key}</dt><dd>{value}개</dd></div>
                  ))}
                </dl>
              </article>
            </div>

          </>
        ) : null}

        {activeTab === "data" ? (
          <>
            <SectionTitle eyebrow="입력" title="원천자료" description="출처를 선택하면 해당 변수의 값과 상태를 확인할 수 있습니다." />
            <div className={styles.sourceGrid}>
              {selectedCase.sourceSummary.map((source) => (
                <button
                  type="button"
                  key={source.source}
                  className={sourceFilter === source.source ? styles.sourceCardActive : styles.sourceCard}
                  onClick={() => setSourceFilter(source.source)}
                  aria-pressed={sourceFilter === source.source}
                >
                  <Database size={18} aria-hidden="true" />
                  <strong>{source.sourceLabel}</strong>
                  <b>{source.featureCount}<small>개 변수</small></b>
                  <span>값 {source.valueCount} · 상태 {source.featureCount - source.valueCount}</span>
                </button>
              ))}
            </div>
            {sourceFilter === "ALL" ? (
              <p className={styles.emptyPrompt}>확인할 자료를 선택하세요.</p>
            ) : (
              <div className={styles.sourceFeatureList}>
                <div className={styles.inlineHeading}><h3>{selectedSourceFeatures[0]?.sourceLabel} · {selectedSourceFeatures.length}개</h3><button type="button" onClick={() => { setActiveTab("features"); }}>94개 표에서 보기 <ChevronRight size={15} /></button></div>
                <div className={styles.miniFeatureGrid}>
                  {selectedSourceFeatures.map((feature) => <FeatureMiniCard feature={feature} key={feature.code} />)}
                </div>
              </div>
            )}

            <section className={styles.triggerSection} aria-labelledby="trigger-heading">
              <div className={styles.sectionHeading}>
                <div><h2 id="trigger-heading">추가 확인 조건</h2></div>
                <p>현재 사례에서 {firedTriggers.length}개 조건에 해당합니다.</p>
              </div>
              <div className={styles.triggerGrid}>
                {selectedCase.triggers.map((trigger) => (
                  <article key={trigger.code} data-fired={trigger.fired ? "true" : "false"}>
                    <span>{trigger.fired ? "질문 발생" : "조건 미충족"}</span>
                    <h3>{trigger.label}</h3>
                    <code>{trigger.inputFeature}</code>
                    <p>실제값 <strong>{formatValue(trigger.inputValue, trigger.inputFeature)}</strong> · 경계 {thresholdLabel(trigger.threshold.operator, trigger.threshold.value, trigger.inputFeature)}</p>
                    <small>채울 변수: {trigger.fills.join(", ")}</small>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "features" ? (
          <>
            <SectionTitle eyebrow="변수화 결과" title="분석 변수" description="94개 변수의 값, 출처와 근거를 조회합니다. 미확인 값은 0과 구분합니다." />
            <div className={styles.featureTotals}>
              <strong>총 {selectedCase.featureSummary.total}개</strong>
              {Object.entries(selectedCase.featureSummary.statusCounts).map(([status, count]) => (
                <span key={status} data-status={status}>{STATUS_LABELS[status] ?? status} {count}</span>
              ))}
            </div>

            <section className={styles.featureTableSection} aria-labelledby="feature-table-heading">
              <div className={styles.tableHeading}><div><h2 id="feature-table-heading">전체 변수</h2></div><strong>{visibleFeatures.length} / 94</strong></div>
              <div className={styles.filters}>
                <label className={styles.search}><Search size={16} /><span className="sr-only">Feature 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="코드명·한글명·설명 검색" /></label>
                <label><ListFilter size={15} /><span className="sr-only">출처 필터</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="ALL">전체 출처</option>{selectedCase.sourceSummary.map((item) => <option key={item.source} value={item.source}>{item.sourceLabel}</option>)}</select></label>
                <label><span className="sr-only">역할 필터</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="ALL">전체 역할</option><option value="SCORE">평가 사용</option><option value="DERIVED">결합 산출</option><option value="QUESTION_TRIGGER">질문 발생</option><option value="CONTEXT">맥락 참고</option></select></label>
                <label><span className="sr-only">상태 필터</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">전체 상태</option>{Object.keys(STATUS_LABELS).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
                {(query || sourceFilter !== "ALL" || roleFilter !== "ALL" || statusFilter !== "ALL") ? <button type="button" onClick={() => { setQuery(""); setSourceFilter("ALL"); setRoleFilter("ALL"); setStatusFilter("ALL"); }}>초기화</button> : null}
              </div>
              {visibleFeatures.length === 0 && <p className={styles.emptyPrompt} role="status">조건에 맞는 변수가 없습니다. 검색어나 필터를 바꿔 주세요.</p>}
              <div className={styles.tableScroll}>
                <table>
                  <thead><tr><th>변수</th><th>출처</th><th>값</th><th>상태</th><th>역할</th></tr></thead>
                  <tbody>
                    {visibleFeatures.map((feature) => (
                      <tr key={feature.code}>
                        <th scope="row"><strong>{feature.label}</strong><code>{feature.code}</code><small>{feature.description}</small></th>
                        <td>{feature.sourceLabel}</td>
                        <td>{formatValue(feature.value, feature.code)}</td>
                        <td><StatusBadge status={feature.status} /></td>
                        <td><div className={styles.roleList}>{feature.roles.map((role) => <span key={role} data-role={role}>{ROLE_LABELS[role] ?? role}</span>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className={styles.interviewGroups}>
              {INTERVIEW_GROUPS.map((group) => (
                <details key={group.title}>
                  <summary><MessageSquareText size={17} /><strong>{group.title}</strong><span>{group.codes.length}개</span></summary>
                  <div>
                    {group.codes.map((code) => {
                      const feature = featureByCode.get(code);
                      const conversion = selectedCase.interviewConversion.items.find((item) => item.feature === code);
                      if (!feature) return null;
                      return (
                        <article key={code}>
                          <header><strong>{feature.label}</strong><StatusBadge status={feature.status} /></header>
                          <code>{feature.code}</code>
                          <p>{formatValue(feature.value, feature.code)}</p>
                          <small>{feature.dtype} · {feature.sourceLabel}</small>
                          {conversion?.evidenceText ? <blockquote>“{conversion.evidenceText}”</blockquote> : <span className={styles.noEvidence}>연결된 원문 없음</span>}
                        </article>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>

            <section className={styles.combinedSection} aria-labelledby="combined-heading">
              <div className={styles.sectionHeading}>
                <div><h2 id="combined-heading">결합 변수 16개</h2></div>
                <p>금융자료와 구조화된 답변을 결합해 계산한 값입니다.</p>
              </div>
              <div className={styles.combinedGrid}>
                {combinedFeatures.map((feature) => <FeatureMiniCard feature={feature} key={feature.code} />)}
              </div>
            </section>


          </>
        ) : null}

        {activeTab === "impact" ? <ModelingResults key={selectedCase.caseId} selectedCase={selectedCase} formatValue={formatValue} /> : null}

        {activeTab === "score" ? (
          <>
            <SectionTitle eyebrow="평가" title="평가기준과 배점" description="각 항목의 적용 구간과 산출 근거를 확인합니다." />
            <div className={styles.axisDetailGrid}>
              <AxisDetail axis={selectedCase.scorecard.currentSituation} title="현재 상황" description="지금 사업이 버틸 수 있는 상태인지" onOpen={openLineage} />
              <AxisDetail axis={selectedCase.scorecard.improvement} title="개선가능성" description="나아질 여지가 있고 그 방향으로 가는지" onOpen={openLineage} />
            </div>
            <InterviewEffect effect={selectedCase.modelingEffect} />
            <ValidationDisclosure validation={validation} modelVersion={model.version} />
          </>
        ) : null}

        {activeTab === "cb" ? (
          <>
            <SectionTitle eyebrow="신용정보" title="기존 신용정보와 사업 현황" description={selectedCase.cbContrast.disclaimer} />
            <div className={styles.cbGrid}>
              <article className={styles.cbLegacy}>
                <span className={styles.cardKicker}><Banknote size={17} /> 기존 CB</span>
                <div className={styles.cbScore}><strong>{formatValue(selectedCase.cbContrast.legacyCb.score)}</strong><span>{formatValue(selectedCase.cbContrast.legacyCb.grade)}</span></div>
                <dl>
                  <div><dt>상위 비율</dt><dd>{formatValue(selectedCase.cbContrast.legacyCb.percentile, "percentile")}</dd></div>
                  <div><dt>연체가능성 입력값</dt><dd>{formatValue(selectedCase.cbContrast.legacyCb.delinquencyProbability, "probability")}</dd></div>
                  <div><dt>월 상환액</dt><dd>{formatValue(selectedCase.cbContrast.legacyCb.monthlyDebtPayment)}원</dd></div>
                </dl>
                <blockquote>{selectedCase.cbContrast.legacyCb.opinion}</blockquote>
              </article>
              <article className={styles.cbContext}>
                <span className={styles.cardKicker}><BookOpenCheck size={17} /> 사업 현황</span>
                <div className={styles.contextList}>
                  {selectedCase.cbContrast.donghaengContext.fields.map((field) => (
                    <div key={field.feature}><span>{field.label}</span><strong>{formatValue(field.value, field.feature)}</strong><code>{field.feature}</code></div>
                  ))}
                </div>
              </article>
            </div>
            <section className={styles.externalSection} aria-labelledby="external-heading">
              <div className={styles.externalStamp}>참고자료</div>
              <div className={styles.sectionHeading}>
                <div><h2 id="external-heading">업종 비교</h2></div>
                <p>{selectedCase.externalContext.disclaimer}</p>
              </div>
              <div className={styles.externalGrid}>
                {selectedCase.externalContext.fields.map((field) => (
                  <article key={field.code}><code>{field.code}</code><strong>{formatValue(field.value, field.code)}</strong><StatusBadge status={field.status} /></article>
                ))}
              </div>
              <p className={styles.boundaryNote}>평가 점수에 포함하지 않는 참고자료입니다. {selectedCase.externalContext.sourceAvailable ? "자료 확인됨" : "등록된 자료 없음"}</p>
            </section>
          </>
        ) : null}

        {activeTab === "goals" || activeTab === "reevaluation" || activeTab === "report" ? (
          <ModelingWorkflow
            key={selectedCase.caseId}
            view={activeTab}
            selectedCase={selectedCase}
            cases={allCases ?? [selectedCase]}
            reevaluation={reevaluation}
            modelVersion={model.version}
            onNavigate={(tab, caseId) => {
              if (caseId && caseId !== selectedCase.caseId) selectCase(caseId, tab);
              else setActiveTab(tab);
            }}
          />
        ) : null}
        <nav className={styles.reviewSequence} aria-label="분석 순서 이동">
          <span>{TABS.findIndex((tab) => tab.id === activeTab) + 1} / {TABS.length} · {TABS.find((tab) => tab.id === activeTab)?.label}</span>
          {activeTab !== "report" ? <button type="button" onClick={() => {
            setActiveTab(TABS[TABS.findIndex((tab) => tab.id === activeTab) + 1].id);
            document.getElementById("modeling-content")?.scrollIntoView({ block: "start" });
            document.getElementById("modeling-content")?.focus({ preventScroll: true });
          }}>다음 · {TABS[TABS.findIndex((tab) => tab.id === activeTab) + 1].label} <ArrowRight size={17} /></button> : <Link href="/">서비스 첫 화면 <ArrowRight size={17} /></Link>}
        </nav>
      </section>

      <details className={styles.pipeline}>
        <summary className={styles.pipelineSummary}>산출 과정 <span>자료 → 변수 → 평가 → 재평가</span></summary>
        <div className={styles.sectionHeading}>
          <div><h2 id="pipeline-heading">데이터 처리 순서</h2></div>
          <p>정형 48개, 맥락 30개, 결합 16개 변수를 사용합니다.</p>
        </div>
        <ol>
          {PIPELINE.map(([title, detail], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
              {index < PIPELINE.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      </details>

      <footer className={styles.footerNote}>
        <p>합성 데이터에 규칙을 적용한 참고 결과입니다. 두 축을 합친 단일 종합점수는 만들지 않습니다. 산출 항목 비율은 신뢰도나 승인 확률이 아닙니다. 실제 상환 결과에 대한 예측 성능은 검증하지 않았습니다.</p>
      </footer>

      {selectedItem ? (
        <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeLineage(); }}>
          <aside id="modeling-lineage-dialog" className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="lineage-heading">
            <header>
              <div><span className={styles.eyebrow}>평가 산출 근거</span><h2 id="lineage-heading">{selectedItem.name}</h2></div>
              <button ref={closeButtonRef} type="button" onClick={closeLineage} aria-label="평가 근거 닫기"><X /></button>
            </header>
            <div className={styles.drawerResult}>
              <div><span>적용 구간</span><strong>{selectedItem.band}</strong></div>
              <div><span>배점</span><strong>{selectedItem.excluded ? "산출 제외" : `${selectedItem.points} / ${selectedItem.maxPoints}`}</strong></div>
              {selectedItem.note ? <p>{selectedItem.note}</p> : null}
            </div>
            <ol className={styles.lineageList}>
              {selectedItem.lineage.map((lineage, index) => (
                <li key={`${lineage.feature}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><small>{lineage.sourceLabel}</small><strong>{lineage.label}</strong><code>{lineage.feature}</code></div>
                  <div><b>{formatValue(lineage.value, lineage.feature)}</b><StatusBadge status={lineage.status} /></div>
                </li>
              ))}
            </ol>
            <p className={styles.drawerFootnote}>해당 평가항목의 계산에 연결된 자료입니다. 개별 변수의 인과 기여도를 뜻하지 않습니다.</p>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function SectionTitle({ title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className={styles.sectionTitle}><h2>{title}</h2><p>{description}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={styles.statusBadge} data-status={status}>{STATUS_LABELS[status] ?? status}</span>;
}

function FeatureMiniCard({ feature }: { feature: ModelingFeature }) {
  return (
    <article className={styles.miniFeature}>
      <header><strong>{feature.label}</strong><StatusBadge status={feature.status} /></header>
      <code>{feature.code}</code>
      <p>{formatValue(feature.value, feature.code)}</p>
      <small>{feature.dtype} · {feature.roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ")}</small>
    </article>
  );
}

function AxisSummary({ axis, title, description, tone, onOpen }: {
  axis: ModelingCase["scorecard"]["currentSituation"];
  title: string;
  description: string;
  tone: "navy" | "green";
  onOpen: (event: MouseEvent<HTMLButtonElement>, item: ModelingScoreItem) => void;
}) {
  const numericScore = typeof axis.score === "number" ? axis.score : 0;
  return (
    <article className={styles.axisSummary} data-tone={tone}>
      <header><div><span>{title}</span><p>{description}</p></div><strong>{formatScore(axis.score)}<small>/100</small></strong></header>
      <div className={styles.axisTrack}><i style={{ width: `${Math.min(100, Math.max(0, numericScore))}%` }} /></div>
      <ScoreAccounting axis={axis} />
      <div className={styles.axisItemChips}>
        {axis.items.map((item) => <button type="button" key={item.name} onClick={(event) => onOpen(event, item)}><span>{item.name}</span><b>{item.excluded ? "제외" : `${item.points}/${item.maxPoints}`}</b></button>)}
      </div>
    </article>
  );
}

function AxisDetail({ axis, title, description, onOpen }: {
  axis: ModelingCase["scorecard"]["currentSituation"];
  title: string;
  description: string;
  onOpen: (event: MouseEvent<HTMLButtonElement>, item: ModelingScoreItem) => void;
}) {
  return (
    <article className={styles.axisDetail}>
      <header><div><span>{description}</span><h3>{title}</h3><small>{axis.basis}</small></div><strong>{formatScore(axis.score)}<small>/100</small></strong></header>
      <ScoreAccounting axis={axis} />
      <div className={styles.scoreBars}>
        {axis.items.map((item) => {
          const percent = item.excluded || item.points === null ? 0 : item.points / item.maxPoints * 100;
          return (
            <button type="button" key={item.name} onClick={(event) => onOpen(event, item)}>
              <span><strong>{item.name}</strong><small>{item.band}</small></span>
              <i><b style={{ width: `${percent}%` }} /></i>
              <em>{item.excluded ? "제외" : `${item.points}/${item.maxPoints}`}</em>
              <ChevronRight size={16} />
            </button>
          );
        })}
      </div>
      {axis.note ? <p className={styles.axisNote}>{axis.note}</p> : null}
    </article>
  );
}

function SameDeclineComparison({
  comparison,
  selectedCaseId,
  onSelectCase,
  allCases,
}: {
  comparison: ModelingBundle["comparisons"]["sameSalesDecline"];
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  allCases?: ModelingCase[];
}) {
  const noAnswerCase = allCases?.find((c) => c.caseId === "case_no_answer");
  const cases = useMemo(() => {
    const list = [...comparison.cases];
    if (noAnswerCase && !list.some((c) => c.caseId === "case_no_answer")) {
      list.push({
        caseId: noAnswerCase.caseId,
        title: noAnswerCase.title,
        salesGrowth3m: -0.2,
        salesDropDriver: "operating_day",
        transactionCountGrowth3m: 0,
        averageTicketGrowth3m: 0,
        operatingDayChange3m: -0.2,
        salesPerOperatingDay3m: 0,
        currentSituationScore: noAnswerCase.scorecard.currentSituation.score,
        improvementScore: noAnswerCase.scorecard.improvement.score,
        salesDirection: {
          points: 0,
          band: "하락(사유 없음)",
          note: "추가 답변 없음",
          lineage: [],
        },
      });
    }
    const order = ["case_operating_drop", "case_customer_drop", "case_ticket_drop", "case_no_answer"];
    return list.sort((a, b) => {
      const idxA = order.indexOf(a.caseId);
      const idxB = order.indexOf(b.caseId);
      return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
    });
  }, [comparison.cases, noAnswerCase]);

  const CONTEXT_DETAILS: Record<string, { label: string; cause: string; context: string; formula: string }> = {
    case_operating_drop: {
      label: "영업일 감소 (사유 해소)",
      cause: "문 연 날 -20%",
      context: "건강 사유, 완치 후 정상 영업",
      formula: "54 ÷ 80 × 100",
    },
    case_customer_drop: {
      label: "손님 감소 (고객 이탈)",
      cause: "결제 건수 -20%",
      context: "사유 미확인 / 수요 이탈",
      formula: "30 ÷ 80 × 100",
    },
    case_ticket_drop: {
      label: "객단가 하락 (가격 인하)",
      cause: "결제 단가 -20%",
      context: "가격 경쟁 / 1인 지출 감소",
      formula: "30 ÷ 80 × 100",
    },
    case_no_answer: {
      label: "추가 설명 없음 (무응답)",
      cause: "문 연 날 -20% (3번과 동일)",
      context: "인터뷰 질문 받았으나 무응답 / 목표 미정",
      formula: "24 ÷ 80 × 100",
    },
  };

  return (
    <section className={styles.comparison} aria-labelledby="comparison-heading">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="comparison-heading">같은 매출 감소(-20%), 4대 원인과 맥락 대조</h2>
        </div>
        <p>최근 3개월 매출 변동률 {formatValue(comparison.invariants.salesGrowth, "growth")} 고정 · 금융데이터와 인터뷰 결합 전후 비교</p>
      </div>

      <div className={styles.comparisonCallout}>
        <strong>핵심 차별점</strong>
        <p>
          동일한 -20% 매출 감소라도 <strong>거래건수 감소 vs 객단가 하락 vs 영업일 감소</strong>의 원인을 데이터로 분해합니다.
          특히 같은 영업일 감소 데이터라도 인터뷰에서 건강 사유 해소를 확인한 가게(<strong>67.5점</strong>)와
          추가 설명이 없는 가게(<strong>30.0점</strong>)는 <strong>37.5점 차이</strong>로 다르게 설명됩니다.
        </p>
      </div>

      <div className={styles.metricTableWrap} tabIndex={0} aria-label="매출 감소 4대 사례 비교 표">
        <table className={styles.comparisonTable}>
          <thead>
            <tr>
              <th>사례</th>
              <th>분해된 감소 원인</th>
              <th>인터뷰 맥락 진술</th>
              <th>매출방향 배점</th>
              <th>현재 상황</th>
              <th>개선가능성</th>
              <th>산출식</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item) => {
              const meta = CONTEXT_DETAILS[item.caseId] ?? {
                label: item.title,
                cause: formatValue(item.salesDropDriver, "sales_drop_driver"),
                context: item.salesDirection?.note || "—",
                formula: "—",
              };
              return (
                <tr key={item.caseId} data-selected={item.caseId === selectedCaseId}>
                  <th scope="row">
                    <button
                      type="button"
                      aria-label={`${item.title} 사례 전체 보기`}
                      aria-pressed={item.caseId === selectedCaseId}
                      onClick={() => onSelectCase(item.caseId)}
                    >
                      {meta.label} <ChevronRight size={15} />
                    </button>
                  </th>
                  <td>{meta.cause}</td>
                  <td>{meta.context}</td>
                  <td>
                    <strong>{item.caseId === "case_operating_drop" ? "10점 (사유 해소)" : "0점 (미해소/사유 없음)"}</strong>
                  </td>
                  <td>{formatScore(item.currentSituationScore)}점</td>
                  <td>
                    <strong style={{ color: item.caseId === "case_operating_drop" ? "var(--green)" : undefined }}>
                      {formatScore(item.improvementScore)}점
                    </strong>
                  </td>
                  <td><small>{meta.formula}</small></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InterviewEffect({ effect }: { effect: ModelingBundle["comparisons"]["interviewEffect"] }) {
  const before = effect.before.scorecard.improvement;
  const after = effect.after.scorecard.improvement;
  return (
    <section className={styles.effect} aria-labelledby="effect-heading">
      <div className={styles.sectionHeading}><div><h2 id="effect-heading">맥락 변수 결합 전후</h2></div><p>같은 금융자료에 맥락 변수의 포함 여부를 달리한 결과입니다.</p></div>
      <div className={styles.effectGrid}>
        <article><span>정형 데이터만</span><strong>{formatScore(before.score)}<small>/100</small></strong><p>{before.itemsUsed} / {before.itemsTotal} 항목으로 산출</p></article>
        <GitCompareArrows aria-hidden="true" />
        <article><span>맥락 변수 결합</span><strong>{formatScore(after.score)}<small>/100</small></strong><p>{after.itemsUsed} / {after.itemsTotal} 항목으로 산출</p></article>
        <article className={styles.effectDelta}><span>환산 점수 차이</span><strong>{effect.improvementScoreDelta !== null && effect.improvementScoreDelta >= 0 ? "+" : ""}{effect.improvementScoreDelta === null ? "—" : formatScore(effect.improvementScoreDelta)}<small>점</small></strong><p>변수 {effect.changedFeatures.length}개 · 평가항목 {effect.changedScoreItems.length}개 변경</p></article>
      </div>
      {!effect.basisComparable ? <p className={styles.warning}><CircleHelp size={16} /> {effect.comparisonWarning}</p> : null}
    </section>
  );
}

function ValidationDisclosure({ validation, modelVersion }: { validation: ModelingBundle["validation"]; modelVersion: string }) {
  const existing = validation.existingModelingValidation;
  return (
    <details className={styles.validation}>
      <summary className={styles.pipelineSummary}>검증 범위와 모델 한계</summary>
      <div className={styles.sectionHeading}><div><h2 id="validation-heading">계산 정합성 검증</h2></div><p>{modelVersion} · SHA-256 {validation.sourceCodeChecksum.value.slice(0, 12)}…</p></div>
      <div className={styles.validationGrid}>
        <div><strong>{validation.featureVector.count}</strong><span>분석 변수</span><small>{validation.featureVector.passed ? "계약 일치" : "불일치"}</small></div>
        <div><strong>{validation.mockCaseCount}</strong><span>합성 검증 사례</span><small>실제 상환 기록 {validation.realOutcomeRecordCount}건</small></div>
        <div><strong>{validation.conditionalQuestionRules.covered}/{validation.conditionalQuestionRules.total}</strong><span>추가 확인 조건</span><small>{validation.conditionalQuestionRules.passed ? "해당·미해당 확인" : "미완료"}</small></div>
        <div><strong>{validation.scorecardBands.executed}/{validation.scorecardBands.total}</strong><span>평가 구간</span><small>미실행 {validation.scorecardBands.unexecuted}</small></div>
        <div><strong>{existing.passed === true ? "일치" : existing.passed === false ? "실패" : "대기"}</strong><span>동일 입력 재실행</span><small>{existing.checksPassed ?? "—"}/{existing.checksTotal ?? "—"} 검사</small></div>
        <div><strong>{validation.bundleContract.passed ? "지원" : "오류"}</strong><span>결측 상태 분리</span><small>{validation.missingStates.join(" · ")}</small></div>
      </div>
      <details>
        <summary>검증 상세와 한계 보기 <ChevronRight size={16} /></summary>
        <div><p><strong>Broken input:</strong> {existing.passed === true ? "기존 modeling.validate의 입력 파손 검사까지 통과" : "전체 빌드 검증에서 확인 예정"}</p><ul>{validation.limitations.map((item) => <li key={item}>{item}</li>)}</ul><p>이 결과는 예측 성능이나 대출 가능성을 증명하지 않습니다. threshold는 실제 금융성과 데이터로 별도 검증·승인해야 합니다.</p></div>
      </details>
    </details>
  );
}
