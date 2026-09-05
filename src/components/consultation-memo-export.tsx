"use client";

import { Download, Printer } from "lucide-react";
import { useState } from "react";
import type { FinalInterviewView } from "./api-adapter";
import { buildConsultationMemo } from "./consultation-memo";

export function ConsultationMemoExport({ snapshot }: { snapshot: FinalInterviewView }) {
  const [notice, setNotice] = useState("");
  const memo = buildConsultationMemo(snapshot);
  function download() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob(["\ufeff", memo], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `동행금융_상담메모_v${snapshot.version}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setNotice("파일 저장을 요청했습니다. 브라우저 다운로드 목록을 확인해 주세요. 금융기관에는 전송되지 않습니다.");
    } catch {
      setNotice("파일을 준비하지 못했습니다. 다시 시도하거나 인쇄 기능을 이용해 주세요.");
    } finally {
      if (url) { const savedUrl = url; setTimeout(() => URL.revokeObjectURL(savedUrl), 1000); }
    }
  }
  return (
    <section className="consultation-memo-export dh-panel" aria-label="금융 상담 준비 메모">
      <div>
        <h2>상담 기록 내보내기</h2>
        <p>답변 원문과 확인 상태를 파일로 저장합니다. 아직 확인하지 못한 항목도 함께 표시됩니다.</p>
      </div>
      <div className="consultation-memo-export__actions">
        <button type="button" className="dh-button" onClick={download}><Download size={18} aria-hidden="true" /> 상담 메모 받기 · TXT</button>
        <button type="button" className="dh-button dh-button--light" onClick={() => window.print()}><Printer size={18} aria-hidden="true" /> 인쇄 / PDF 저장</button>
      </div>
      <p className="dh-footnote">사업 정보와 답변 원문이 포함됩니다. 공식 증빙·대출 심사 결과가 아니며, 공유는 직접 결정해 주세요.</p>
      {notice && <p role="status">{notice}</p>}
      <div className="consultation-memo-print"><pre>{memo}</pre></div>
    </section>
  );
}
