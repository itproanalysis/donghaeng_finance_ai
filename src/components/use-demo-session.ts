"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  DEMO_SESSION_KEY,
  parseDemoSession,
  type DemoSession,
} from "@/domain/service-demo";

const CHANGE_EVENT = "donghaeng-demo-session-change";
let memoryFallback: string | null = null;
let writeUnavailable = false;
function getSnapshot() {
  try {
    return JSON.stringify({
      raw: writeUnavailable
        ? memoryFallback
        : sessionStorage.getItem(DEMO_SESSION_KEY),
      unavailable: writeUnavailable,
    });
  } catch {
    return JSON.stringify({ raw: memoryFallback, unavailable: true });
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
function serverSnapshot() {
  return "server";
}
function update(session: DemoSession) {
  memoryFallback = JSON.stringify(session);
  try {
    sessionStorage.setItem(DEMO_SESSION_KEY, memoryFallback);
    writeUnavailable = false;
  } catch {
    writeUnavailable = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useDemoSession() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const state = useMemo(
    () =>
      snapshot === "server"
        ? { raw: null, unavailable: false }
        : (JSON.parse(snapshot) as {
            raw: string | null;
            unavailable: boolean;
          }),
    [snapshot],
  );
  const session = useMemo(() => parseDemoSession(state.raw), [state.raw]);
  return {
    session,
    ready: snapshot !== "server",
    storageError: state.unavailable,
    update,
  };
}
