"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authenticatedFetch, readApiEnvelope } from "@/components/api-adapter";
import { emptyConsultationDraft, type ConsultationDraftData, type ConsultationDraftRecord } from "@/domain/consultation-draft";

export function useConsultationDraft(interviewId?: string) {
  const [draft, setDraft] = useState<ConsultationDraftData>(emptyConsultationDraft);
  const [saved, setSaved] = useState(() => JSON.stringify(emptyConsultationDraft()));
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!interviewId);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!interviewId);
  const [error, setError] = useState<string | null>(null);
  const pendingSave = useRef(false);
  const dirty = JSON.stringify(draft) !== saved;

  const applyRecord = useCallback((record: ConsultationDraftRecord) => {
    if (!record || record.interviewId !== interviewId || !Number.isSafeInteger(record.revision) || !record.data) {
      throw new Error("상담 초안 응답을 확인할 수 없습니다.");
    }
    setDraft(record.data);
    setSaved(JSON.stringify(record.data));
    setRevision(record.revision);
    setUpdatedAt(record.updatedAt);
    setLoaded(true);
  }, [interviewId]);

  const fetchDraft = useCallback(async (signal?: AbortSignal) => {
    if (!interviewId) return;
    const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consultation-draft`, { cache: "no-store", signal });
    return await readApiEnvelope(response) as ConsultationDraftRecord;
  }, [interviewId]);

  useEffect(() => {
    if (!interviewId) return;
    const controller = new AbortController();
    fetchDraft(controller.signal).then((record) => {
      if (record && !controller.signal.aborted) applyRecord(record);
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "저장된 초안을 불러오지 못했습니다.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applyRecord, fetchDraft, interviewId]);

  useEffect(() => {
    if (!interviewId || !dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const beforeNavigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.origin === window.location.origin) return;
      if (!window.confirm("저장하지 않은 상담 초안이 있습니다. 저장하지 않고 이동할까요?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeNavigate, true); };
  }, [dirty, interviewId]);

  async function reload() {
    if (pendingSave.current || (dirty && !window.confirm("현재 변경 내용을 취소하고 서버에 저장된 최신 초안을 불러올까요?"))) return;
    setLoading(true);
    setError(null);
    try { const record = await fetchDraft(); if (record) applyRecord(record); } catch (caught) { setError(caught instanceof Error ? caught.message : "초안을 불러오지 못했습니다."); } finally { setLoading(false); }
  }

  async function save() {
    if (!interviewId || !loaded || loading || pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consultation-draft`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, data: draft }),
      });
      applyRecord(await readApiEnvelope(response) as ConsultationDraftRecord);
    } catch (caught) {
      // Keep the local edits (and old revision) on any failure, including conflicts.
      setError(caught instanceof Error ? caught.message : "초안을 저장하지 못했습니다. 입력 내용은 현재 화면에 남아 있습니다.");
    } finally { pendingSave.current = false; setSaving(false); }
  }

  return { draft, setDraft, dirty, loading, saving, loaded, error, revision, updatedAt, save, reload };
}
