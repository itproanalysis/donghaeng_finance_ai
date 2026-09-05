"use client";

import { ArrowRight, CircleAlert, LayoutGrid, List, RefreshCw, Search, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiRequestError, authenticatedFetch, readApiEnvelope } from "@/components/api-adapter";
import { interviewNextAction, type InterviewOperationsResult, type OperationsFilter } from "@/domain/interview-operations";

const FILTERS: { value: OperationsFilter; label: string; count: keyof InterviewOperationsResult["summary"] }[] = [
  { value: "ALL", label: "전체 가게", count: "total" },
  { value: "ACTIVE", label: "이야기 중", count: "active" },
  { value: "ATTENTION", label: "추가 확인", count: "attention" },
  { value: "COMPLETE", label: "정리 완료", count: "complete" },
  { value: "INCOMPLETE", label: "중단 기록", count: "incomplete" },
];
const STATUS_LABELS = { ACTIVE: "이야기 중", COMPLETE: "정리 완료", INCOMPLETE: "중단 기록" };
const PAGE_SIZE = 12;

function recordDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "갱신 시각 확인 필요" : new Intl.DateTimeFormat("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function AdminOperationsBoard() {
  const [result, setResult] = useState<InterviewOperationsResult | null>(null);
  const [status, setStatus] = useState<OperationsFilter>("ALL");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<"street" | "list">("list");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      setNeedsLogin(false);
      try {
        const params = new URLSearchParams({ status, q: query.trim(), limit: String(PAGE_SIZE), offset: String(offset) });
        const response = await authenticatedFetch(`/api/interviews?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await readApiEnvelope(response) as InterviewOperationsResult;
        if (!data || !Array.isArray(data.items) || !data.summary) throw new Error("상담 목록 형식을 확인할 수 없습니다.");
        if (controller.signal.aborted) return;
        setResult(data);
        setCheckedAt(new Date().toISOString());
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "상담 기록을 불러오지 못했습니다.");
        setNeedsLogin(caught instanceof ApiRequestError && ["AUTHENTICATION_REQUIRED", "SESSION_EXPIRED"].includes(caught.code ?? ""));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [offset, query, refresh, status]);

  function changeFilter(value: OperationsFilter) { setStatus(value); setOffset(0); setLoading(true); }

  return (
    <section className="operations-board" aria-labelledby="operations-heading">
      <header className="operations-board__heading">
        <div><h2 id="operations-heading">인터뷰 기록</h2></div>
        <a className="dh-button" href="#new-interview">새 인터뷰 접수 <ArrowRight size={17} /></a>
      </header>
      <div className="operations-stations" role="group" aria-label="상담 상태 필터">
        {FILTERS.map((filter, index) => (
          <button key={filter.value} type="button" aria-pressed={status === filter.value} onClick={() => changeFilter(filter.value)}>
            <span className="operations-stations__number" aria-hidden="true">0{index + 1}</span>
            <span>{filter.label}<strong>{result ? result.summary[filter.count] : "—"}<small>건</small></strong></span>
          </button>
        ))}
      </div>
      <div className="operations-toolbar">
        <label className="operations-search"><Search size={18} aria-hidden="true" /><span className="sr-only">가게·사장님 이름 또는 인터뷰 번호 검색</span><input type="search" placeholder="가게·사장님 이름으로 찾기" value={query} maxLength={100} onChange={(event) => { setQuery(event.target.value); setOffset(0); setLoading(true); }} /></label>
        <div className="operations-view" role="group" aria-label="목록 보기 방식">
          <button type="button" aria-pressed={view === "street"} onClick={() => setView("street")}><LayoutGrid size={17} />카드 보기</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} />목록 보기</button>
        </div>
        <button className="operations-refresh" type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}><RefreshCw size={17} className={loading ? "spin" : undefined} />새로고침</button>
      </div>
      <div className="operations-freshness"><span>담당 기관의 기록</span><span>{checkedAt ? `${recordDate(checkedAt)} 조회 · 새로고침으로 갱신` : "기록 연결 중"}</span></div>
      {error && <div className="operations-feedback" role="alert"><CircleAlert size={22} /><div><strong>기록을 불러오지 못했습니다</strong><p>{error}</p>{needsLogin ? <Link className="dh-button" href="/login?next=%2Finterviews">담당자 로그인</Link> : <button type="button" className="dh-button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>다시 불러오기</button>}</div></div>}
      {loading ? <p className="operations-loading" role="status">인터뷰 기록을 불러오는 중입니다…</p> : !error && result && (
        <>
          <p className="sr-only" role="status">검색 결과 {result.total}건</p>
          {result.items.length === 0 ? <div className="operations-empty"><Store size={32} /><h3>{query || status !== "ALL" ? "조건에 맞는 기록이 없어요" : "첫 가게의 이야기를 기다리고 있어요"}</h3><p>{query || status !== "ALL" ? "이름이나 상담 상태를 바꿔 확인해 주세요." : "새 인터뷰를 접수하면 이곳에 실제 진행 상황이 나타납니다."}</p>{query || status !== "ALL" ? <button type="button" className="dh-button dh-button--light" onClick={() => { setQuery(""); changeFilter("ALL"); }}>전체 기록 보기</button> : <a className="dh-button" href="#new-interview">첫 인터뷰 접수</a>}</div> : (
            <div className={`operations-cases operations-cases--${view}`}>
              {result.items.map((item) => {
                const action = interviewNextAction(item);
                return <article className="operations-case" data-tone={action.tone} key={item.id}>
                  <div className="operations-case__shop"><Store size={21} aria-hidden="true" /><span>{item.industry || "업종 미확인"}</span><span className="operations-case__status">{STATUS_LABELS[item.lifecycleStatus]}</span></div>
                  <div className="operations-case__identity"><h3>{item.businessName}</h3><p>{item.borrowerName} 사장님</p></div>
                  <div className="operations-case__next"><small>{item.lifecycleStatus === "ACTIVE" ? "현재 질문" : "다음 업무"}</small><strong>{item.lifecycleStatus === "ACTIVE" ? item.currentQuestionLabel ?? "답변 정리와 종료 검토" : action.label}</strong></div>
                  <p className="operations-case__facts">답변 {item.borrowerAnswerCount}개{item.lifecycleStatus === "ACTIVE" && <> · 남은 필수 항목 {item.unresolvedRequiredCount}개</>}</p>
                  {(item.conflictCount > 0 || item.processingFailed) && <p className="operations-case__warning"><CircleAlert size={14} />{item.processingFailed ? "답변 처리 상태 확인 필요" : `서로 다른 답변 ${item.conflictCount}건 확인 필요`}</p>}
                  <footer><time dateTime={item.updatedAt}>{recordDate(item.updatedAt)}</time><Link href={action.href} aria-label={`${item.businessName} · ${action.label}`}>{action.label}<ArrowRight size={16} /></Link></footer>
                </article>;
              })}
            </div>
          )}
          <nav className="operations-pagination" aria-label="상담 목록 페이지"><span>{result.total === 0 ? "0건" : `${offset + 1}–${offset + result.items.length} / ${result.total}건`}</span><button type="button" disabled={offset === 0} onClick={() => { setOffset((value) => Math.max(0, value - PAGE_SIZE)); setLoading(true); }}>이전</button><button type="button" disabled={!result.hasMore} onClick={() => { setOffset((value) => value + PAGE_SIZE); setLoading(true); }}>다음</button></nav>
        </>
      )}
    </section>
  );
}
