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
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [filterReferenceTime, setFilterReferenceTime] = useState(0);

  const fetchList = useCallback(async () => {
    const response = await authenticatedFetch("/api/interview-evaluations", {
      cache: "no-store",
    });
    const payload = await readApiEnvelope(response);
    return adaptEvaluationList(payload);
  }, []);

  useEffect(() => {
    let active = true;
    fetchList()
      .then((nextList) => {
        if (!active) return;
        setList(nextList);
        setFilterReferenceTime(Date.now());
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
    return () => {
      active = false;
    };
  }, [fetchList]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setList(await fetchList());
      setFilterReferenceTime(Date.now());
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : "인터뷰 평가 목록을 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [fetchList]);

  const visibleItems = useMemo(() => {
    if (!list) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const selectedPeriod = PERIOD_OPTIONS.find((option) => option.value === period);
    const cutoff = selectedPeriod?.days && filterReferenceTime > 0
      ? filterReferenceTime - selectedPeriod.days * 24 * 60 * 60 * 1000
      : null;

    return list.items.filter((item) => {
      if (industry !== "all" && item.industry !== industry) return false;
      if (level !== "all" && item.overallLevel !== level) return false;
      if (cutoff !== null) {
        const createdAt = new Date(item.completedAt ?? item.createdAt).getTime();
        if (!Number.isFinite(createdAt) || createdAt < cutoff) return false;
      }
      if (!normalizedQuery) return true;
      return [
        item.borrowerName,
        item.businessName,
        item.industry,
        item.id,
        item.interviewId,
      ].some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
    });
  }, [filterReferenceTime, industry, level, list, period, query]);

  return (
    <main id="main-content" className="evaluation-list-page">
      <header className="evaluation-list-hero">
        <div>
          <p className="panel-kicker">FINAL INTERVIEW RECORDS</p>
          <h1>인터뷰 평가</h1>
          <p>확정 스냅샷으로 생성된 평가를 검색하고 근거 상세로 이동합니다.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => void load()}
          disabled={isLoading}
          aria-label="평가 목록 새로고침"
          title="평가 목록 새로고침"
        >
          <RefreshCw className={isLoading ? "spin" : undefined} size={18} />
        </button>
      </header>

      <section className="evaluation-list-toolbar" aria-label="평가 검색 및 필터">
        <label className="evaluation-list-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">차주명, 사업체명 또는 평가 ID 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="차주명, 사업체명 또는 평가 ID 검색"
          />
        </label>
        <label>
          <span className="sr-only">업종 필터</span>
          <select value={industry} onChange={(event) => setIndustry(event.target.value)}>
            <option value="all">전체 업종</option>
            {list?.facets.industries.map((value) => (
              <option value={value} key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">평가등급 필터</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="all">전체 평가등급</option>
            {list?.facets.levels.map((value) => (
              <option value={value} key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">기간 필터</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            {PERIOD_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      {isLoading && !list ? (
        <LoadingState
          title="평가 목록을 불러오는 중입니다"
          description="현재 사업자 계정에서 조회 가능한 확정 평가를 확인하고 있습니다."
        />
      ) : loadError ? (
        <ErrorState
          title="인터뷰 평가 목록을 불러오지 못했습니다"
          description={loadError}
          onRetry={() => void load()}
          retrying={isLoading}
        />
      ) : (
        <section className="evaluation-list-results" aria-labelledby="evaluation-result-heading">
          <div className="evaluation-list-results__heading">
            <h2 id="evaluation-result-heading">평가 결과</h2>
            <span>{visibleItems.length}건</span>
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
              <strong>조건에 맞는 평가가 없습니다.</strong>
              <p>검색어나 필터를 변경하거나 새 AI인터뷰를 완료해 주세요.</p>
              <Link className="button button--primary" href="/interviews">
                AI인터뷰 시작
              </Link>
            </div>
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
