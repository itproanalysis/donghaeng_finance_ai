"use client";
import Link from "next/link";
import { useState } from "react";
import { FlowSteps, ServiceHeader } from "../components/ServiceNavigation";
import {
  CHECK_DOCUMENTS,
  QUEST_LABELS,
  proposalsFor,
  type CaseReview,
} from "../lib/case-model";
import {
  INSTITUTIONS,
  consultationText,
  preparationReady,
} from "../lib/consultation-report";
import { deleteCase, saveCase, selectCase, useCases } from "../lib/case-store";
import { importInterview } from "../lib/case-transfer";

export default function AdminPage() {
  const { cases, current: record, ready } = useCases();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"analysis" | "plan" | "finance">("analysis");
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  async function loadInterview(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 64000)
        throw new Error("64KB 이하의 동행금융 인터뷰 파일을 선택해 주세요.");
      const item = importInterview(await file.text());
      if (cases.some((c) => c.id === item.id)) {
        selectCase(item.id);
        setMessage(
          "이미 저장된 기록을 열었습니다. 기존 답변과 검토 내용을 유지했습니다.",
        );
      } else {
        saveCase(item);
        setMessage(
          "전달받은 인터뷰를 가져왔습니다. 작성자와 내용의 정확성은 담당자가 별도로 확인해 주세요.",
        );
      }
      setView("analysis");
      setRemoving(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "기록을 가져오지 못했습니다.",
      );
    }
  }
  const visible = cases.filter(
    (c) =>
      (!query.trim() ||
        `${c.businessName} ${c.borrowerName}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())) &&
      (filter === "all" ||
        (filter === "complete" && !!c.completedAt) ||
        (filter === "active" && !c.completedAt)),
  );
  const proposal = record
    ? proposalsFor(record).find((p) => p.id === record.review.proposalId)
    : null;
  function updateReview(patch: Partial<CaseReview>) {
    if (!record) return;
    try {
      saveCase({
        ...record,
        updatedAt: new Date().toISOString(),
        review: { ...record.review, ...patch },
      });
      setMessage("검토 초안을 이 브라우저에 저장했습니다.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
    }
  }
  function download() {
    if (!record) return;
    try {
      const text = consultationText(record);
      const url = URL.createObjectURL(
        new Blob(["\ufeff", text], { type: "text/plain;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "동행금융_상담준비자료.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "상담 준비자료를 내려받았습니다. 금융기관에 전송하지 않았습니다.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "자료를 만들지 못했습니다.");
    }
  }
  return (
    <>
      <ServiceHeader />
      <main className="companion-page admin-page">
        <header className="admin-page-title">
          <div>
            <span className="companion-kicker">관리자의 동행</span>
            <h1>
              상황을 이해하고,
              <br />
              다음 행동을 연결합니다.
            </h1>
            <p>
              이 기기에서 작성하거나 사장님에게 전달받은 인터뷰를 검토합니다.
            </p>
          </div>
          <Link
            className="companion-button companion-button--light"
            href="/guide"
          >
            서비스 흐름 보기 ↗
          </Link>
        </header>
        <section className="companion-panel interview-import">
          <div>
            <h2>다른 기기에서 작성한 인터뷰도 이어서 검토하세요.</h2>
            <p>
              사장님의 결과 화면에서 내려받은 인터뷰 기록(JSON)을 가져옵니다.
              파일은 이 브라우저에만 저장됩니다.
            </p>
          </div>
          <label className="companion-button companion-button--light">
            인터뷰 기록 가져오기 ↑
            <input
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                void loadInterview(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </section>
        {message && (
          <p className="companion-status" role="status">
            {message}
          </p>
        )}
        <div className="admin-counts">
          <span>
            <strong>{cases.length}</strong> 전체 기록
          </span>
          <span>
            <strong>{cases.filter((c) => !c.completedAt).length}</strong> 인터뷰
            진행 중
          </span>
          <span>
            <strong>{cases.filter((c) => c.completedAt).length}</strong> 인터뷰
            완료
          </span>
          <span>
            <strong>
              {
                cases.filter((c) => preparationReady(c) && c.review.institution)
                  .length
              }
            </strong>{" "}
            상담자료 준비
          </span>
        </div>
        <FlowSteps
          admin
          active={
            !record ? 0 : view === "analysis" ? 1 : view === "plan" ? 2 : 3
          }
        />
        {!ready ? (
          <p role="status">기록을 불러오고 있습니다.</p>
        ) : cases.length === 0 ? (
          <section className="companion-empty">
            <span className="mission-number">동</span>
            <h2>아직 작성된 인터뷰가 없습니다.</h2>
            <p>
              이 기기에서 인터뷰를 시작하거나, 사장님에게 전달받은 기록을 위에서
              가져와 주세요.
            </p>
            <Link className="companion-button" href="/demo">
              첫 인터뷰 시작하기 →
            </Link>
          </section>
        ) : (
          <div className="admin-workspace">
            <aside className="case-directory companion-panel">
              <h2>사장님 현황</h2>
              <label>
                <span className="sr-only">사업체·사장님 검색</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="사업체·사장님 검색"
                />
              </label>
              <label>
                <span className="sr-only">상태 필터</span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">모든 인터뷰</option>
                  <option value="active">진행 중</option>
                  <option value="complete">완료된 인터뷰</option>
                </select>
              </label>
              <div className="case-directory-list">
                {visible.map((c) => (
                  <button
                    key={c.id}
                    aria-pressed={record?.id === c.id}
                    className={record?.id === c.id ? "is-selected" : ""}
                    onClick={() => {
                      try {
                        selectCase(c.id);
                        setView("analysis");
                        setMessage("");
                        setRemoving(null);
                      } catch (e) {
                        setMessage(
                          e instanceof Error
                            ? e.message
                            : "기록을 선택하지 못했습니다.",
                        );
                      }
                    }}
                  >
                    <small>
                      {c.completedAt ? "인터뷰 완료" : "진행 중"} · 답변{" "}
                      {c.answers.length}/3
                    </small>
                    <strong>
                      {c.businessName || "골목에서 이야기 시작 중"}
                    </strong>
                    <span>
                      {c.borrowerName || "호칭 미입력"} ·{" "}
                      {new Date(c.updatedAt).toLocaleDateString("ko-KR")}
                    </span>
                  </button>
                ))}
              </div>
              {!visible.length && <p>검색 조건에 맞는 기록이 없습니다.</p>}
            </aside>
            <div className="admin-record">
              {!record ? (
                <div className="companion-panel">
                  왼쪽에서 검토할 기록을 선택해 주세요.
                </div>
              ) : (
                <>
                  <header className="record-heading">
                    <div>
                      <span className="companion-kicker">INTERVIEW RECORD</span>
                      <h2>{record.businessName || "진행 중인 인터뷰"}</h2>
                    </div>
                    <div className="companion-actions">
                      <Link href={record.completedAt ? "/results" : "/demo"}>
                        {record.completedAt
                          ? "사장님 결과 보기"
                          : "인터뷰 이어가기"}{" "}
                        ↗
                      </Link>
                      <button
                        className="text-button"
                        onClick={() => setRemoving(record.id)}
                      >
                        기록 삭제
                      </button>
                    </div>
                  </header>
                  {removing === record.id && (
                    <div className="companion-warning">
                      <p>
                        {record.businessName || "이 인터뷰"}의 답변과 검토
                        초안을 이 브라우저에서 삭제할까요? 삭제 후 복구할 수
                        없습니다.
                      </p>
                      <button
                        className="companion-button"
                        onClick={() => {
                          try {
                            deleteCase(record.id);
                            setRemoving(null);
                            setMessage("기록을 삭제했습니다.");
                          } catch (e) {
                            setMessage(
                              e instanceof Error
                                ? e.message
                                : "삭제하지 못했습니다.",
                            );
                          }
                        }}
                      >
                        이 기록 삭제
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setRemoving(null)}
                      >
                        취소
                      </button>
                    </div>
                  )}
                  <nav className="record-tabs" aria-label="관리자 검토 단계">
                    <button
                      aria-current={view === "analysis" ? "step" : undefined}
                      onClick={() => setView("analysis")}
                    >
                      현황·근거 분석
                    </button>
                    <button
                      aria-current={view === "plan" ? "step" : undefined}
                      disabled={!record.completedAt}
                      onClick={() => setView("plan")}
                    >
                      개선안·실행 점검
                    </button>
                    <button
                      aria-current={view === "finance" ? "step" : undefined}
                      disabled={!record.completedAt}
                      onClick={() => setView("finance")}
                    >
                      금융기관 연결
                    </button>
                  </nav>
                  {view === "analysis" ? (
                    <>
                      <section className="companion-panel">
                        <div className="section-title">
                          <h3>원문으로 확인하는 사업 상황</h3>
                          <span className="companion-tag">
                            객관적 증빙 미검증
                          </span>
                        </div>
                        {record.answers.length ? (
                          record.answers.map((a, i) => (
                            <details
                              key={a.questionId}
                              className="admin-evidence"
                              open
                            >
                              <summary>
                                <span>0{i + 1}</span>
                                {a.questionText}
                              </summary>
                              <blockquote>{a.answerText}</blockquote>
                              <small>
                                사장님 입력 ·{" "}
                                {new Date(a.acceptedAt).toLocaleString("ko-KR")}{" "}
                                · 답변 버전 {a.revision}
                              </small>
                            </details>
                          ))
                        ) : (
                          <p>
                            아직 저장한 인터뷰 답변이 없습니다. 사장님
                            인터뷰에서 이어갈 수 있습니다.
                          </p>
                        )}
                      </section>
                      {record.quests.some(Boolean) && (
                        <section className="companion-panel">
                          <h3>골목에서 선택한 관심·준비 내용</h3>
                          <dl className="quest-facts">
                            {record.quests.map(
                              (q, i) =>
                                q && (
                                  <div key={i}>
                                    <dt>{QUEST_LABELS[i]}</dt>
                                    <dd>{q}</dd>
                                  </div>
                                ),
                            )}
                          </dl>
                        </section>
                      )}
                      <section className="analysis-next">
                        <div>
                          <h3>다음 상담에서 확인할 빈칸</h3>
                          <p>
                            매출·비용의 실제 금액, 기존 상환 내역, 자금
                            목적·필요 금액과 증빙은 별도로 확인해야 합니다.
                            인터뷰의 정성 답변만으로 금액이나 신용도를 추정하지
                            않습니다.
                          </p>
                        </div>
                        <button
                          className="companion-button"
                          disabled={!record.completedAt}
                          onClick={() => setView("plan")}
                        >
                          근거를 바탕으로 개선안 검토 →
                        </button>
                      </section>
                    </>
                  ) : view === "plan" ? (
                    <>
                      <p className="companion-note">
                        답변에서 준비한 실행 후보입니다. 선택만으로 사장님과
                        합의한 목표가 되지는 않습니다.
                      </p>
                      <div className="admin-proposal-grid">
                        {proposalsFor(record).map((p) => (
                          <button
                            className={`companion-panel proposal-option${record.review.proposalId === p.id ? " is-selected" : ""}`}
                            aria-pressed={record.review.proposalId === p.id}
                            onClick={() =>
                              updateReview({
                                proposalId: p.id,
                                reviewed: false,
                              })
                            }
                            key={p.id}
                          >
                            <small>{p.source}</small>
                            <h3>{p.title}</h3>
                            <blockquote>{p.reason}</blockquote>
                            <p>{p.action}</p>
                            <strong>
                              {record.review.proposalId === p.id
                                ? "✓ 검토 후보 선택됨"
                                : "이 실행 후보 검토하기 →"}
                            </strong>
                          </button>
                        ))}
                      </div>
                      <section className="companion-panel preparation-panel">
                        <h3>실행 계획과 준비자료</h3>
                        <div className="companion-fields">
                          <label>
                            점검 담당
                            <select
                              value={record.review.owner}
                              onChange={(e) =>
                                updateReview({
                                  owner: e.target.value,
                                  reviewed: false,
                                })
                              }
                            >
                              <option>사장님과 담당자</option>
                              <option>사장님과 경영지원 담당자</option>
                            </select>
                          </label>
                          <label>
                            다음 점검일
                            <input
                              type="date"
                              value={record.review.dueDate}
                              onChange={(e) =>
                                updateReview({
                                  dueDate: e.target.value,
                                  reviewed: false,
                                })
                              }
                            />
                          </label>
                        </div>
                        <label className="companion-check">
                          <input
                            type="checkbox"
                            checked={record.review.reviewed}
                            disabled={!proposal || !record.review.dueDate}
                            onChange={(e) =>
                              updateReview({ reviewed: e.target.checked })
                            }
                          />
                          <span>
                            개선 후보와 점검 계획을 검토했습니다.
                            <small>
                              실행·성과를 달성했다는 표시가 아닙니다.
                            </small>
                          </span>
                        </label>
                        <div className="preparation-documents">
                          <h3>실제로 확인한 자료만 체크하세요.</h3>
                          <p className="companion-note">
                            증빙은 이 화면에 업로드되지 않습니다. 원본은 별도로
                            준비해야 합니다.
                          </p>
                          {CHECK_DOCUMENTS.map((d) => (
                            <label className="companion-check" key={d}>
                              <input
                                type="checkbox"
                                checked={record.review.documents.includes(d)}
                                onChange={(e) =>
                                  updateReview({
                                    documents: e.target.checked
                                      ? [...record.review.documents, d]
                                      : record.review.documents.filter(
                                          (x) => x !== d,
                                        ),
                                  })
                                }
                              />
                              {d}
                            </label>
                          ))}
                        </div>
                        <button
                          className="companion-button"
                          onClick={() => setView("finance")}
                        >
                          금융기관 상담 준비 →
                        </button>
                      </section>
                    </>
                  ) : (
                    <>
                      <section className="companion-panel">
                        <span className="companion-kicker">금융기관 연결</span>
                        <h2>상담 경로를 확인하고 자료를 준비합니다.</h2>
                        <p>
                          제휴·접수·승인을 뜻하지 않습니다. 공식 안내에서 최신
                          상담 절차와 조건을 확인해 주세요.
                        </p>
                        <div className="institution-options">
                          {INSTITUTIONS.map((i) => (
                            <article
                              key={i.id}
                              className={
                                record.review.institution === i.id
                                  ? "is-selected"
                                  : ""
                              }
                            >
                              <small>{i.type}</small>
                              <h3>{i.name}</h3>
                              <p>{i.description}</p>
                              <a
                                href={i.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                공식 안내 확인 ↗
                              </a>
                              <button
                                className="companion-button companion-button--light"
                                aria-pressed={
                                  record.review.institution === i.id
                                }
                                onClick={() =>
                                  updateReview({ institution: i.id })
                                }
                              >
                                {record.review.institution === i.id
                                  ? "✓ 상담 검토 기관 선택됨"
                                  : "상담 검토 기관으로 선택"}
                              </button>
                            </article>
                          ))}
                        </div>
                      </section>
                      <section className="companion-handoff">
                        <div>
                          <span className="companion-tag">기관 미전송</span>
                          <h3>
                            {preparationReady(record)
                              ? "상담자료를 준비할 수 있습니다."
                              : "개선안·점검일·준비자료 확인이 필요합니다."}
                          </h3>
                          <p>
                            현황 원문·개선안·점검 계획·기관 안내를 한 자료로
                            정리합니다.
                          </p>
                          {!preparationReady(record) && (
                            <button
                              className="text-button"
                              onClick={() => setView("plan")}
                            >
                              남은 준비사항 확인하기 →
                            </button>
                          )}
                        </div>
                        <button
                          className="companion-button"
                          disabled={
                            !preparationReady(record) ||
                            !record.review.institution
                          }
                          onClick={download}
                        >
                          상담 준비자료 내려받기 ↓
                        </button>
                      </section>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <p className="companion-note">
          기록과 검토 내용은 현재 브라우저에 저장됩니다. 다른 기기에는 자동으로
          동기화되지 않습니다. 가져온 기록은 작성자와 증빙 확인을 거쳐 검토해
          주세요.
        </p>
      </main>
    </>
  );
}
