"use client";
import { useMemo, useSyncExternalStore } from "react";
import {
  EMPTY_REVIEW,
  readCollection,
  type CompanionCase,
  type CaseCollection,
} from "./case-model.ts";
const KEY = "donghaeng-companion-cases-v1";
const ACTIVE = "donghaeng-current-case";
const EVENT = "donghaeng:cases-updated";
function snapshot() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "unavailable";
  }
}
function activeSnapshot() {
  try {
    return sessionStorage.getItem(ACTIVE) ?? "";
  } catch {
    return "";
  }
}
function activate(id: string) {
  try {
    sessionStorage.setItem(ACTIVE, id);
  } catch {
    throw new Error(
      "이 탭에 기록을 연결하지 못했습니다. 브라우저 저장 설정을 확인해 주세요.",
    );
  }
}
export function getCurrentCase() {
  return (
    readCollection(snapshot()).cases.find((c) => c.id === activeSnapshot()) ??
    null
  );
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
function write(collection: CaseCollection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(collection));
  } catch {
    throw new Error(
      "이 브라우저에 저장하지 못했습니다. 저장 공간과 개인정보 보호 설정을 확인해 주세요.",
    );
  }
  window.dispatchEvent(new Event(EVENT));
}
export function useCases() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "server");
  const activeId = useSyncExternalStore(subscribe, activeSnapshot, () => "");
  const collection = useMemo(() => readCollection(raw), [raw]);
  return {
    ...collection,
    currentId: activeId || null,
    ready: raw !== "server",
    unavailable: raw === "unavailable",
    current: collection.cases.find((c) => c.id === activeId) ?? null,
  };
}
export function saveCase(item: CompanionCase) {
  const c = readCollection(snapshot());
  if (!c.cases.some((i) => i.id === item.id) && c.cases.length >= 50)
    throw new Error(
      "이 브라우저에 50건이 저장되어 있습니다. 관리자에서 불필요한 기록을 삭제한 뒤 시작해 주세요.",
    );
  activate(item.id);
  write({
    ...c,
    currentId: item.id,
    cases: [item, ...c.cases.filter((i) => i.id !== item.id)],
  });
}
export function startCase(quests: Array<string | null> = [null, null, null]) {
  const now = new Date().toISOString();
  const item: CompanionCase = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    businessName: "",
    borrowerName: "",
    quests: [...quests],
    answers: [],
    completedAt: null,
    review: { ...EMPTY_REVIEW, documents: [] },
  };
  saveCase(item);
  return item;
}
export function selectCase(id: string) {
  const c = readCollection(snapshot());
  if (c.cases.some((i) => i.id === id)) {
    activate(id);
    window.dispatchEvent(new Event(EVENT));
  }
}
export function deleteCase(id: string) {
  const c = readCollection(snapshot());
  write({
    ...c,
    currentId: c.currentId === id ? null : c.currentId,
    cases: c.cases.filter((i) => i.id !== id),
  });
}
export function recordQuest(index: number, answer: string) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 2 ||
    !answer.trim() ||
    answer.length > 100
  )
    throw new Error("골목 질문과 선택을 확인해 주세요.");
  const current = getCurrentCase();
  const item = current && !current.completedAt ? current : startCase();
  const quests = [...item.quests];
  quests[index] = answer;
  saveCase({ ...item, quests, updatedAt: new Date().toISOString() });
}
