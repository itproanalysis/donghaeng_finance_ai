"use client";

import Link from "next/link";
import { useState } from "react";

interface AlleyAdminDeskProps {
  initialTab?: "dossier" | "cases" | "workbench";
}

interface CaseItem {
  id: string;
  name: string;
  industry: string;
  status: "완비" | "대화완료" | "서류준비중";
  stage: string;
  monthlySales: string;
  repaymentCapacity: string;
  date: string;
}

const CASES_DATA: CaseItem[] = [
  {
    id: "CASE-001",
    name: "동행카페 지원님",
    industry: "카페 · 음료",
    status: "완비",
    stage: "3대 회복 근거 구비 완료",
    monthlySales: "2,200만 원",
    repaymentCapacity: "월 470만 원",
    date: "2026. 09. 04",
  },
  {
    id: "CASE-002",
    name: "성수동 햇살 베이커리",
    industry: "제과 · 제빵",
    status: "대화완료",
    stage: "현금흐름 습관 정비 중",
    monthlySales: "3,100만 원",
    repaymentCapacity: "월 380만 원",
    date: "2026. 09. 03",
  },
  {
    id: "CASE-003",
    name: "문래동 가죽공방",
    industry: "공예 · 제조소매",
    status: "서류준비중",
    stage: "카드매출 정산서 수집 단계",
    monthlySales: "1,450만 원",
    repaymentCapacity: "월 220만 원",
    date: "2026. 09. 02",
  },
  {
    id: "CASE-004",
    name: "연남동 골목서점",
    industry: "서적 · 문화",
    status: "완비",
    stage: "상환 계획표 작성 완료",
    monthlySales: "1,100만 원",
    repaymentCapacity: "월 180만 원",
    date: "2026. 09. 01",
  },
];

const INSTITUTIONS = [
  {
    name: "소상공인시장진흥공단",
    sub: "정책자금 · 재도전 특별지원 상담",
    url: "https://www.semas.or.kr",
    doc: "상황 변화 진술서, 매출 회복 입증자료",
  },
  {
    name: "지역신용보증재단 (서울신보)",
    sub: "사업장 소재지 보증 연계 심사",
    url: "https://www.koreg.or.kr",
    doc: "상가 임대차 계약서, 최근 3개월 카드 매출 정산서",
  },
  {
    name: "신용보증기금",
    sub: "경영회복 컨설팅 및 소상공인 보증",
    url: "https://www.kodit.or.kr",
    doc: "향후 12개월 상환 계획표, 지출 정비안",
  },
];

export function AlleyAdminDesk({ initialTab = "dossier" }: AlleyAdminDeskProps) {
  const [tab, setTab] = useState<"dossier" | "cases" | "workbench">(initialTab);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("CASE-001");
  const [checkedDocs, setCheckedDocs] = useState<Record<string, boolean>>({
    doc1: true,
    doc2: true,
    doc3: true,
  });

  const selectedCase = CASES_DATA.find((c) => c.id === selectedCaseId) || CASES_DATA[0]!;

  function handleCopy() {
    const text = `[동행금융 골목길 회복 심사 보고서]
- 문서번호: 동행-2026-0904-01호
- 상호 및 차주: ${selectedCase.name} (${selectedCase.industry})
- 회복 진도: ${selectedCase.stage} (3대 근거 완비)
- 월평균 매출: ${selectedCase.monthlySales} / 실질 상환 여력: ${selectedCase.repaymentCapacity}
- 01 사업 공백과 매출 회복: 매장 리뉴얼 및 신메뉴 개발 완료 후 단골 고객 복귀로 정상 영업 궤도 진입
- 02 월 자금 흐름과 상환 여력: 불필요한 구독/통신비 정비 및 원재료 발주 정밀화로 실질 잉여 자금 확보
- 03 제출 준비 자료 패키지: 최근 3개월 카드 매출 정산서, 임대차 계약서, 향후 12개월 상환 계획표 구비 완료
- 심사 의견: 단순 점수 하락이 아닌 리뉴얼 공백이었으며, 실질 상환 여력과 증빙이 충분하여 지원 검토 적합함.`;

    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function toggleDoc(key: string) {
    setCheckedDocs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const filteredCases = CASES_DATA.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.industry.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="alley-admin-desk-page">
      {/* Top Header - 현판 및 정갈한 내비게이션 */}
      <header className="alley-admin-header">
        <div className="alley-admin-header-inner">
          <div className="alley-admin-brand-group">
            <Link href="/" className="alley-admin-brand" aria-label="새벽 골목길 홈으로">
              <span className="alley-admin-logo-mark">동</span>
              동행금융
            </Link>
            <span className="alley-admin-divider">/</span>
            <span className="alley-admin-station-name">새벽 골목길 상담소 · 심사역 집무실</span>
          </div>

          <nav className="alley-admin-nav-links">
            <Link href="/" className="alley-admin-nav-btn">
              골목길 걷기
            </Link>
            <Link href="/borrower" className="alley-admin-nav-btn">
              사장님 대화실
            </Link>
            <Link href="/login" className="alley-admin-nav-btn alley-admin-nav-btn--secondary">
              상담사 세션
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Desk Content */}
      <main className="alley-admin-main">
        {/* Tab Navigation - 서류철 탭 */}
        <div className="dossier-tab-bar">
          <button
            type="button"
            className={`dossier-tab-btn${tab === "dossier" ? " is-active" : ""}`}
            onClick={() => setTab("dossier")}
          >
            [제 1 철] 동행 회복 심사 보고서 (3대 근거)
          </button>
          <button
            type="button"
            className={`dossier-tab-btn${tab === "cases" ? " is-active" : ""}`}
            onClick={() => setTab("cases")}
          >
            [제 2 철] 골목길 차주 회복 상담 대장 ({CASES_DATA.length}건)
          </button>
          <button
            type="button"
            className={`dossier-tab-btn${tab === "workbench" ? " is-active" : ""}`}
            onClick={() => setTab("workbench")}
          >
            [제 3 철] 정책금융기관 제출 안내 및 봉투
          </button>
        </div>

        {/* Tab 1: 심사역 서류철 (Official Physical Recovery Dossier Folder) */}
        {tab === "dossier" && (
          <article className="dossier-folio" aria-label="동행 회복 심사 보고서">
            {/* 좌측 바인더 제본 장식 */}
            <div className="dossier-binder-spine" aria-hidden="true" />

            <div className="dossier-sheet">
              {/* 상단 서식 번호 및 주육 심사필 인감 날인 */}
              <div className="dossier-header-grid">
                <div className="dossier-reg-block">
                  <span className="dossier-reg-no">문서 등록번호: 동행-2026-0904-01호</span>
                  <span className="dossier-reg-class">보존 구분: 소상공인 회복 근거 (심사 참고자료)</span>
                </div>

                <div className="dossier-stamp-seal" aria-label="동행금융 심사필 인영">
                  <div className="stamp-frame">
                    <span className="stamp-title">同行金融</span>
                    <span className="stamp-status">審査濟</span>
                  </div>
                  <span className="stamp-sub">심사필</span>
                </div>
              </div>

              {/* 보고서 공식 표제 */}
              <div className="dossier-title-block">
                <h1 className="dossier-main-heading">동 행 회 복 심 사 보 고 서</h1>
                <p className="dossier-sub-heading">
                  새벽 골목길 현장 동행 대화 기반 · 사장님 3대 회복 근거 조사철
                </p>
              </div>

              {/* 차주 기본 정보 및 접수 현황 표 */}
              <table className="dossier-meta-table">
                <tbody>
                  <tr>
                    <th>차주 상호명</th>
                    <td><strong>{selectedCase.name}</strong></td>
                    <th>업종 및 업력</th>
                    <td>{selectedCase.industry} (업력 4년)</td>
                  </tr>
                  <tr>
                    <th>접수 일자</th>
                    <td>{selectedCase.date} 새벽 현장 대화 완결</td>
                    <th>담당 심사 부서</th>
                    <td>동행금융 골목길 현장심사팀</td>
                  </tr>
                  <tr>
                    <th>회복 진도</th>
                    <td>
                      <span className="dossier-badge-pill">● {selectedCase.stage}</span>
                    </td>
                    <th>종합 소견</th>
                    <td>
                      <strong className="dossier-strong-verdict">실질 상환 여력 확인 · 정성 심사 건의</strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 제 1 절: 사업 재개 및 매출 회복 경위 */}
              <section className="dossier-chapter">
                <div className="dossier-chapter-header">
                  <span className="dossier-chapter-num">제 1 절</span>
                  <h2>사업 재개 및 매출 회복 경위 (구술 진술 및 현장 조사 소견)</h2>
                </div>

                <div className="dossier-quote-panel">
                  <span className="quote-panel-tag">차주 구술 진술 원문</span>
                  <p className="quote-panel-text">
                    “가게 리뉴얼과 새 메뉴 개발로 다시 매출이 오르고 있어요. 단골 손님들이 다시 찾아오고 있습니다.”
                  </p>
                </div>

                <div className="dossier-examiner-remark">
                  <span className="remark-tag">현장 심사역 조사 의견</span>
                  <p>
                    단순 영업 부진에 따른 연체가 아니라, 노후 매장 환경 리뉴얼 및 신메뉴 출시를 위한 일시적 휴업 공백이었음.
                    리뉴얼 공사 완료 후 재오픈하여 단골 고객 복귀와 신규 유입으로 최근 3개월간 뚜렷한 매출 반등세를 확인하였으며,
                    정상 영업 궤도에 조기 안착한 상태로 판단됨.
                  </p>
                </div>
              </section>

              {/* 제 2 절: 실질 현금흐름 및 지출 정비 계획 */}
              <section className="dossier-chapter">
                <div className="dossier-chapter-header">
                  <span className="dossier-chapter-num">제 2 절</span>
                  <h2>실질 현금흐름 및 지출 정비 계획 (상환 여력 산정표)</h2>
                </div>

                <table className="dossier-accounting-table">
                  <thead>
                    <tr>
                      <th>항목 구분</th>
                      <th>월평균 매출액</th>
                      <th>고정비 및 원재료비</th>
                      <th>실질 가용 상환 여력</th>
                      <th>지출 감축 실천 내역</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>월별 산출액</strong></td>
                      <td><span className="table-number">{selectedCase.monthlySales}</span></td>
                      <td><span className="table-number">1,550만 원</span></td>
                      <td><span className="table-number table-number--highlight">{selectedCase.repaymentCapacity}</span></td>
                      <td>불필요한 통신비·구독료 정비, 원재료 발주 정밀화</td>
                    </tr>
                  </tbody>
                </table>

                <div className="dossier-examiner-remark" style={{ marginTop: "14px" }}>
                  <span className="remark-tag">상환 안정성 종합 판정</span>
                  <p>
                    임대료 등 고정 비용 및 필수 운영비를 성실히 차감한 후에도 매월 <strong>{selectedCase.repaymentCapacity}</strong>의
                    실질 잉여 현금이 발생하고 있어, 신용점수 일시 하락에도 불구하고 향후 정책자금 및 원리금의 안정적인 분할 상환 능력이 충분히 입증됨.
                  </p>
                </div>
              </section>

              {/* 제 3 절: 금융기관 대출심사 필수 구비 증빙 목록 */}
              <section className="dossier-chapter">
                <div className="dossier-chapter-header">
                  <span className="dossier-chapter-num">제 3 절</span>
                  <h2>금융기관 대출심사 필수 구비 증빙 목록 (증빙 확인서)</h2>
                </div>

                <div className="dossier-checklist-paper">
                  <div className="checklist-row">
                    <span className="checklist-seal">[확인필 ㊞]</span>
                    <div className="checklist-detail">
                      <strong>최근 3개월 카드 매출 정산 내역서</strong>
                      <p>전년 동기 대비 가맹점 매출 회복세 및 실매출 입증 자료 구비 완료</p>
                    </div>
                  </div>

                  <div className="checklist-row">
                    <span className="checklist-seal">[확인필 ㊞]</span>
                    <div className="checklist-detail">
                      <strong>상가 임대차 계약서 및 매장 리뉴얼 공사 계약·영수증</strong>
                      <p>사업장 영속성 및 시설 투자 목적 휴업이었음을 증명하는 공적 서류 일체</p>
                    </div>
                  </div>

                  <div className="checklist-row">
                    <span className="checklist-seal">[확인필 ㊞]</span>
                    <div className="checklist-detail">
                      <strong>향후 12개월 실질 상환 계획표</strong>
                      <p>지출 감축안을 반영한 현실적 월별 분할 상환 스케줄 완비</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* 하단 결재란 및 종합 건의 */}
              <footer className="dossier-footer-signoff">
                <div className="signoff-note">
                  <p>
                    ※ 본 보고서는 자동 승인·거절 시스템이 아니며, 사람 심사역이 차주의 구체적 회복 맥락과 실질 상환 여력을 공감하고
                    기계적 점수 거절을 지양하도록 돕는 정성 심사 보조자료입니다.
                  </p>
                </div>

                <div className="signoff-auth-box">
                  <span className="signoff-date">2026년 9월 4일</span>
                  <div className="signoff-row">
                    <span>동행금융 골목길 현장심사팀 심사역 일동</span>
                    <span className="signoff-seal-mark">[합의검토 ㊞]</span>
                  </div>
                </div>

                {/* 하단 동작 버튼 */}
                <div className="dossier-action-bar">
                  <button
                    type="button"
                    className="dossier-action-btn dossier-action-btn--copy"
                    onClick={handleCopy}
                  >
                    {copied ? "✓ 복사 완료됨" : "상담 요약서 복사"}
                  </button>
                  <button
                    type="button"
                    className="dossier-action-btn dossier-action-btn--print"
                    onClick={() => window.print()}
                  >
                    공식 서류철 인쇄
                  </button>
                </div>
              </footer>
            </div>
          </article>
        )}

        {/* Tab 2: 전체 상담 현황 (골목길 차주 회복 상담 대장) */}
        {tab === "cases" && (
          <article className="dossier-folio" aria-label="골목길 차주 회복 상담 대장">
            <div className="dossier-binder-spine" aria-hidden="true" />

            <div className="dossier-sheet">
              <div className="dossier-title-block" style={{ marginBottom: "20px" }}>
                <span className="dossier-reg-no">등록 대장 번호: 동행-회복대장-2026-09</span>
                <h1 className="dossier-main-heading">골 목 길 차 주 회 복 상 담 대 장</h1>
                <p className="dossier-sub-heading">새벽 골목길 동행 상담을 거친 소상공인 회복 진도 및 서류철 목록</p>
              </div>

              <div className="ledger-filter-row">
                <div className="ledger-search-wrap">
                  <span className="ledger-search-label">대장 검색:</span>
                  <input
                    type="text"
                    placeholder="차주명, 상호명, 업종 입력..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="ledger-search-input"
                  />
                </div>
                <span className="ledger-count-info">총 <strong>{filteredCases.length}</strong>건의 회복 서류철 등재</span>
              </div>

              <table className="dossier-ledger-table">
                <thead>
                  <tr>
                    <th>관리번호</th>
                    <th>상호 및 차주</th>
                    <th>업종</th>
                    <th>회복 단계</th>
                    <th>월평균 매출</th>
                    <th>월 상환 가용액</th>
                    <th>상담 일자</th>
                    <th>서류철 열람</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedCaseId ? "is-selected-ledger-row" : ""}
                    >
                      <td><code>{item.id}</code></td>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.industry}</td>
                      <td>
                        <span className={`ledger-status-tag status-${item.status}`}>
                          {item.stage}
                        </span>
                      </td>
                      <td>{item.monthlySales}</td>
                      <td><strong className="ledger-capacity-amount">{item.repaymentCapacity}</strong></td>
                      <td>{item.date}</td>
                      <td>
                        <button
                          type="button"
                          className="ledger-open-btn"
                          onClick={() => {
                            setSelectedCaseId(item.id);
                            setTab("dossier");
                          }}
                        >
                          서류철 열람 →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        )}

        {/* Tab 3: 정책금융기관 제출 안내 및 봉투 */}
        {tab === "workbench" && (
          <article className="dossier-folio" aria-label="정책금융기관 제출 안내 및 봉투">
            <div className="dossier-binder-spine" aria-hidden="true" />

            <div className="dossier-sheet">
              <div className="dossier-title-block" style={{ marginBottom: "20px" }}>
                <span className="dossier-reg-no">안내문 번호: 동행-제출안내-2026-03</span>
                <h1 className="dossier-main-heading">정 책 금 융 기 관 제 출 안 내 문</h1>
                <p className="dossier-sub-heading">골목길 회복 서류철을 금융기관 및 정책보증 심사 시 제출하는 공식 절차</p>
              </div>

              <div className="inst-envelope-grid">
                {/* 왼쪽: 기관별 연계 창구 */}
                <div className="inst-column">
                  <h2 className="inst-column-title">1. 추천 정책금융기관 및 제출처</h2>
                  <div className="inst-cards-list">
                    {INSTITUTIONS.map((inst) => (
                      <div key={inst.name} className="inst-box">
                        <div className="inst-box-header">
                          <strong>{inst.name}</strong>
                          <a
                            href={inst.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inst-link"
                          >
                            공식 창구 →
                          </a>
                        </div>
                        <p className="inst-sub-text">{inst.sub}</p>
                        <div className="inst-doc-tag">
                          <span>권장 첨부 서류:</span> {inst.doc}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 오른쪽: 심사 제출 전 서류 점검표 */}
                <div className="inst-column">
                  <h2 className="inst-column-title">2. 사전 서류 완비 점검표</h2>
                  <div className="inst-checklist-box">
                    <label className="inst-check-row">
                      <input
                        type="checkbox"
                        checked={checkedDocs.doc1}
                        onChange={() => toggleDoc("doc1")}
                      />
                      <div>
                        <strong>차주 구술 회복 진술서 (상황 및 변화 원인 소명)</strong>
                        <p>매출 정체 원인 및 신메뉴·리뉴얼 성과가 상세히 기재되었는가?</p>
                      </div>
                    </label>

                    <label className="inst-check-row">
                      <input
                        type="checkbox"
                        checked={checkedDocs.doc2}
                        onChange={() => toggleDoc("doc2")}
                      />
                      <div>
                        <strong>월 현금흐름 및 지출 절감 계획서</strong>
                        <p>고정비 정비 후 실질 상환 가능액(월 470만 원)이 명확히 도출되었는가?</p>
                      </div>
                    </label>

                    <label className="inst-check-row">
                      <input
                        type="checkbox"
                        checked={checkedDocs.doc3}
                        onChange={() => toggleDoc("doc3")}
                      />
                      <div>
                        <strong>증빙 서류 패키지 (카드 정산서·임대차 계약서)</strong>
                        <p>최근 3개월 정산서와 사업장 계약서 사본이 첨부되었는가?</p>
                      </div>
                    </label>

                    <div className="inst-download-wrap">
                      <button
                        type="button"
                        className="dossier-action-btn dossier-action-btn--print"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={handleCopy}
                      >
                        {copied ? "✓ 복사 완료됨" : "기관 제출용 상담 요약서 복사"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
