"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type NaverLatLng = object;
type NaverSize = object;
type NaverListener = object;

type NaverPanorama = {
  setPosition: (position: NaverLatLng) => void;
  setPov: (pov: { pan: number; tilt: number; fov: number }) => void;
  setSize: (size: NaverSize) => void;
};

type NaverMapsApi = {
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  Size: new (width: number, height: number) => NaverSize;
  Panorama: new (
    element: HTMLElement,
    options: {
      position: NaverLatLng;
      pov: { pan: number; tilt: number; fov: number };
      aroundControl: boolean;
      zoomControl: boolean;
      flightSpot: boolean;
      logoControl: boolean;
    },
  ) => NaverPanorama;
  Event: {
    addListener: (target: object, eventName: string, listener: (event?: unknown) => void) => NaverListener;
    removeListener: (listener: NaverListener) => void;
  };
};

declare global {
  interface Window {
    naver?: { maps: NaverMapsApi };
  }
}

const BASE_SCRIPT_ID = "naver-maps-sdk";
const PANORAMA_SCRIPT_ID = "naver-maps-panorama-sdk";
let naverMapsPromise: Promise<NaverMapsApi> | null = null;

const route = [
  { latitude: 37.55692, longitude: 126.90572, pan: 137, tilt: 1, fov: 96 },
  { latitude: 37.55688, longitude: 126.90577, pan: 138, tilt: 1, fov: 92 },
  { latitude: 37.55684, longitude: 126.90583, pan: 138, tilt: 1, fov: 88 },
  { latitude: 37.5568, longitude: 126.90588, pan: 139, tilt: 1, fov: 84 },
  { latitude: 37.55676, longitude: 126.90594, pan: 139, tilt: 0, fov: 80 },
  { latitude: 37.55671, longitude: 126.906, pan: 140, tilt: 0, fov: 76 },
  { latitude: 37.55667, longitude: 126.90605, pan: 141, tilt: 0, fov: 72 },
];

function loadScript(id: string, source: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("네이버 지도 요청이 거절되었습니다.")), { once: true });
    if (!existing) {
      script.id = id;
      script.async = true;
      script.src = source;
      document.head.appendChild(script);
    }
  });
}

function loadNaverMaps(keyId: string) {
  if (typeof window.naver?.maps?.Panorama === "function") return Promise.resolve(window.naver.maps);
  if (naverMapsPromise) return naverMapsPromise;

  naverMapsPromise = loadScript(
    BASE_SCRIPT_ID,
    `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(keyId)}`,
  ).then(() => loadScript(
    PANORAMA_SCRIPT_ID,
    "https://oapi.map.naver.com/openapi/v3/maps-panorama.js",
  )).then(() => {
    if (typeof window.naver?.maps?.Panorama === "function") return window.naver.maps;
    throw new Error("네이버 파노라마 SDK를 불러오지 못했습니다.");
  });

  return naverMapsPromise;
}

function interpolate(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

export default function NaverPanoramaJourney() {
  const rootRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"fallback" | "loading" | "ready" | "error">(() =>
    process.env.NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID?.trim() ? "loading" : "fallback",
  );

  useEffect(() => {
    const root = rootRef.current;
    const panoramaElement = panoramaRef.current;
    const page = document.querySelector<HTMLElement>(".mission-road-home");
    if (!root || !panoramaElement || !page) return;

    gsap.registerPlugin(ScrollTrigger);
    const keyId = process.env.NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID?.trim();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let targetProgress = 0;
    let currentProgress = 0;
    let frame = 0;
    let panorama: NaverPanorama | null = null;
    let maps: NaverMapsApi | null = null;
    let stage = -1;
    let entered = false;
    let resizeObserver: ResizeObserver | null = null;
    const naverListeners: NaverListener[] = [];

    const setJourneyProgress = (progress: number) => {
      const normalized = Math.max(0, Math.min(1, progress));
      root.style.setProperty("--scene-progress", normalized.toFixed(4));
      page.style.setProperty("--scene-progress", normalized.toFixed(4));

      const mission = normalized < 0.34 ? 0 : normalized < 0.68 ? 1 : 2;
      window.dispatchEvent(
        new CustomEvent("donghaeng:progress", {
          detail: { progress: normalized, mission },
        }),
      );

      if (panorama && maps) {
        const streetProgress = Math.min(1, normalized / 0.8);
        const routePosition = streetProgress * (route.length - 1);
        const nextStage = Math.min(route.length - 1, Math.floor(routePosition + 0.001));
        if (nextStage !== stage) {
          const point = route[nextStage];
          panorama.setPosition(new maps.LatLng(point.latitude, point.longitude));
          stage = nextStage;
        }

        const segment = Math.min(route.length - 1.001, routePosition);
        const fromIndex = Math.floor(segment);
        const toIndex = Math.min(route.length - 1, fromIndex + 1);
        const amount = segment - fromIndex;
        const from = route[fromIndex];
        const to = route[toIndex];
        root.style.setProperty("--walk-stride", amount.toFixed(4));
        panorama.setPov({
          pan: interpolate(from.pan, to.pan, amount),
          tilt: interpolate(from.tilt, to.tilt, amount),
          fov: interpolate(from.fov, to.fov, amount),
        });
      }

      if (!entered && normalized > 0.994 && targetProgress > 0.997) {
        entered = true;
        window.dispatchEvent(new CustomEvent("donghaeng:enter-demo"));
      }
    };

    const render = () => {
      const smoothing = reduceMotion ? 1 : 0.075;
      currentProgress += (targetProgress - currentProgress) * smoothing;
      if (Math.abs(targetProgress - currentProgress) < 0.0001) currentProgress = targetProgress;
      setJourneyProgress(currentProgress);
      frame = window.requestAnimationFrame(render);
    };

    const scrollTrigger = ScrollTrigger.create({
      trigger: page,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        targetProgress = self.progress;
      },
    });

    if (keyId) {
      loadNaverMaps(keyId)
        .then((loadedMaps) => {
          if (!root.isConnected || !panoramaElement.isConnected) return;
          maps = loadedMaps;
          const first = route[0];
          panorama = new maps.Panorama(panoramaElement, {
            position: new maps.LatLng(first.latitude, first.longitude),
            pov: { pan: first.pan, tilt: first.tilt, fov: first.fov },
            aroundControl: false,
            zoomControl: false,
            flightSpot: false,
            logoControl: true,
          });
          naverListeners.push(
            maps.Event.addListener(panorama, "init", () => setStatus("ready")),
            maps.Event.addListener(panorama, "pano_status", (event) => {
              if (typeof event === "string" && event !== "OK") setStatus("error");
            }),
          );
          resizeObserver = new ResizeObserver(([entry]) => {
            if (!entry || !panorama || !maps) return;
            panorama.setSize(new maps.Size(entry.contentRect.width, entry.contentRect.height));
          });
          resizeObserver.observe(panoramaElement);
        })
        .catch(() => setStatus("error"));
    }

    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      scrollTrigger.kill();
      resizeObserver?.disconnect();
      if (maps) naverListeners.forEach((listener) => maps?.Event.removeListener(listener));
      root.style.removeProperty("--scene-progress");
      root.style.removeProperty("--walk-stride");
      page.style.removeProperty("--scene-progress");
    };
  }, []);

  const isMapVisible = status === "ready" || status === "loading";

  return (
    <div ref={rootRef} className={`naver-panorama-journey is-${status}`} aria-hidden="true">
      <div className="naver-panorama-fallback" />
      <div ref={panoramaRef} className="naver-panorama-canvas" style={{ opacity: isMapVisible ? 1 : 0 }} />
      <div className="naver-panorama-finish"><i /></div>
      {status !== "ready" && (
        <span className="naver-panorama-status">
          {status === "loading" ? "네이버 거리뷰를 준비하고 있습니다" : "카페로 향하는 회복 경로"}
        </span>
      )}
    </div>
  );
}
