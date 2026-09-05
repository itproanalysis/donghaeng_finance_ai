"use client";

import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  adaptEvaluationList,
  authenticatedFetch,
  formatPercent,
  type EvaluationListView,
  readApiEnvelope,
} from "@/components/api-adapter";
import { ErrorState, LoadingState } from "@/components/request-state";

const PERIOD_OPTIONS = [
  { value: "all", label: "전체 기간", days: null },
  { value: "7", label: "최근 7일", days: 7 },
  { value: "30", label: "최근 30일", days: 30 },
  { value: "90", label: "최근 90일", days: 90 },
] as const;

function evaluationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function EvaluationList() {
  const [list, setList] = useState<EvaluationListView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState("all");
  const [level, setLevel] = useState("all");
  const [period, setPeriod] = useState("all");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const pageSize = 24;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      setLoadError(null);
      const parameters = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (query.trim()) parameters.set("q", query.trim());
      if (industry !== "all") parameters.set("industry", industry);
      if (level !== "all") parameters.set("level", level);
      const days = PERIOD_OPTIONS.find(option => option.value === period)?.days;
      if (days) parameters.set("from", new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10));
      void authenticatedFetch(`/api/interview-evaluations?${parameters}`, { cache: "no-store", signal: controller.signal })
      .then(readApiEnvelope)
      .then(adaptEvaluationList)
      .then((nextList) => {
        if (!active) return;
        if (offset > 0 && offset >= nextList.total) {
          setOffset(Math.max(0, Math.floor((nextList.total - 1) / pageSize) * pageSize));
          return;
        }
        setList(nextList);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "인터뷰 평가 목록을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, industry, level, period, offset, reloadKey]);

  const load = () => setReloadKey(value => value + 1);
  const visibleItems = list?.items ?? [];

  return (
    <main id="main-content" className="evaluation-list-page">
      <header className="evaluation-list-hero">
        <div>
          <p className="panel-kicker">상담 기록</p>
          <h1>완료 기록</h1>
          <p>확정된 인터뷰의 답변과 근거를 검토합니다.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => void load()}
          disabled={isLoading}
          aria-label="완료 기록 새로고침"
          title="완료 기록 새로고침"
        >
          <RefreshCw className={isLoading ? "spin" : undefined} size={18} />
        </button>
      </header>

      <section className="evaluation-list-toolbar" aria-label="완료 기록 검색 및 필터">
        <label className="evaluation-list-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">가게·사장님 이름 또는 기록 번호 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
            maxLength={100}
            placeholder="가게·사장님 이름으로 찾기"
          />
        </label>
        <label>
          <span className="sr-only">업종 필터</span>
          <select value={industry} onChange={(event) => { setIndustry(event.target.value); setOffset(0); }}>
            <option value="all">전체 업종</option>
            {list?.facets.industries.map((value) => (
              <option value={value} key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">인터뷰 데이터 품질 필터</span>
          <select value={level} onChange={(event) => { setLevel(event.target.value); setOffset(0); }}>
            <option value="all">전체 데이터 품질</option>
            {list?.facets.levels.map((value) => (
              <option value={value} key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">기간 필터</span>
          <select value={period} onChange={(event) => { setPeriod(event.target.value); setOffset(0); }}>
            {PERIOD_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      {isLoading ? (
        <LoadingState
          headingLevel={2}
          title="완료 기록을 불러오고 있어요"
          description="담당 기관의 확정된 인터뷰 기록을 확인합니다."
        />
      ) : loadError ? (
        <ErrorState
          headingLevel={2}
          title="완료 기록을 불러오지 못했습니다"
          description={loadError}
          onRetry={() => void load()}
          retrying={isLoading}
        />
      ) : (
        <section className="evaluation-list-results" aria-labelledby="evaluation-result-heading">
          <div className="evaluation-list-results__heading">
            <h2 id="evaluation-result-heading">완료된 인터뷰</h2>
            <span role="status">검색 결과 {list?.total ?? 0}건</span>
          </div>
          {visibleItems.length > 0 ? (
            <div className="evaluation-list-table">
              {visibleItems.map((item) => (
                <Link
                  className="evaluation-list-row"
                  href={`/interview-evaluations/${encodeURIComponent(item.id)}`}
                  key={item.id}
                  aria-label={`${item.borrowerName ?? "차주 정보 없음"} 인터뷰 평가 상세 보기`}
                >
                  <div className="evaluation-list-row__identity">
                    <strong>{item.borrowerName ?? "차주 정보 없음"}</strong>
                    <span>{item.businessName ?? "사업체 정보 없음"}</span>
                  </div>
                  <div className="evaluation-list-row__industry">
                    <span>{item.industry ?? "업종 정보 없음"}</span>
                    <small>{evaluationDate(item.completedAt ?? item.createdAt)}</small>
                  </div>
                  <div className="evaluation-list-row__metrics">
                    <span>
                      <ClipboardCheck size={14} aria-hidden="true" />
                      정보수집 {formatPercent(item.informationRate)}
                    </span>
                    <span>
                      <Target size={14} aria-hidden="true" />
                      목표 {item.goalCount}개
                    </span>
                    <span>
                      <CalendarDays size={14} aria-hidden="true" />
                      {item.status === "READY" ? "평가완료" : item.status}
                    </span>
                  </div>
                  <div className="evaluation-list-row__grade">
                    <span>인터뷰 데이터 품질</span>
                    <strong>{item.overallLevelLabel}</strong>
                    <small>{formatPercent(item.overallScore)}</small>
                  </div>
                  <ChevronRight size={19} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="evaluation-list-empty">
              <ClipboardCheck size={24} aria-hidden="true" />
              <strong>{query || industry !== "all" || level !== "all" || period !== "all" ? "조건에 맞는 완료 기록이 없어요." : "아직 완료된 인터뷰가 없어요."}</strong>
              <p>{query || industry !== "all" || level !== "all" || period !== "all" ? "검색 조건을 초기화해 전체 기록을 확인해 보세요." : "진행 중인 인터뷰를 마치면 답변과 근거를 이곳에서 검토할 수 있습니다."}</p>
              {(query || industry !== "all" || level !== "all" || period !== "all") && <button type="button" className="button button--secondary" onClick={() => { setQuery(""); setIndustry("all"); setLevel("all"); setPeriod("all"); setOffset(0); setIsLoading(true); }}>검색 조건 초기화</button>}
              <Link className="button button--primary" href="/interviews">
                상담 대장으로 이동
              </Link>
            </div>
          )}
          {list && list.total > pageSize && (
            <nav className="operations-pagination" aria-label="완료 기록 페이지">
              <button className="button button--ghost" type="button" disabled={isLoading || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>이전</button>
              <span>{Math.floor(offset / pageSize) + 1} / {Math.ceil(list.total / pageSize)} 페이지</span>
              <button className="button button--ghost" type="button" disabled={isLoading || offset + pageSize >= list.total} onClick={() => setOffset(offset + pageSize)}>다음</button>
            </nav>
          )}
        </section>
      )}

      <div className="decision-boundary-note evaluation-list-boundary">
        <ClipboardCheck size={16} aria-hidden="true" />
        <p>표시된 등급과 점수는 인터뷰 데이터 품질이며 신용등급이나 승인 판단이 아닙니다.</p>
      </div>
    </main>
  );
}
