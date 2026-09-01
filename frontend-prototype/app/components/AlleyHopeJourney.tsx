"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function AlleyHopeJourney() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const page = document.querySelector<HTMLElement>(".mission-road-home");
    if (!root || !page) return;

    gsap.registerPlugin(ScrollTrigger);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let targetProgress = 0;
    let currentProgress = 0;
    let frame = 0;
    let entered = false;
    let targetLookX = 0;
    let targetLookY = 0;
    let currentLookX = 0;
    let currentLookY = 0;
    let gaitPhase = 0;
    let walkStrength = 0;
    let lastFrameTime = performance.now();
    let lastScrollInput = 0;

    const smoothstep = (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      return clamped * clamped * (3 - 2 * clamped);
    };

    const updateJourney = (progress: number, gait: number, gaitStrength: number) => {
      const normalized = Math.max(0, Math.min(1, progress));
      const interiorReveal = smoothstep((normalized - 0.82) / 0.16);
      const arrivalGlow = Math.sin(interiorReveal * Math.PI) * 0.96;
      const motion = gaitStrength * (1 - interiorReveal);
      const stride = reduceMotion ? 0 : Math.sin(gait) * motion * 2.2;
      const sway = reduceMotion ? 0 : Math.sin(gait * 0.5) * motion * 1.2;
      const walkRoll = reduceMotion ? 0 : Math.sin(gait * 0.5) * motion * 0.12;
      const walkPitch = reduceMotion ? 0 : Math.abs(Math.cos(gait)) * motion * 0.08;
      const stepZoom = reduceMotion ? 0 : Math.abs(Math.sin(gait)) * motion * 0.0015;
      const stepSide = reduceMotion ? 0 : Math.sin(gait * 0.5) * motion * 5;
      const roadGlow = smoothstep((normalized - 0.06) / 0.76);
      root.style.setProperty("--scene-progress", normalized.toFixed(4));
      root.style.setProperty("--interior-reveal", interiorReveal.toFixed(4));
      root.style.setProperty("--arrival-glow", arrivalGlow.toFixed(4));
      root.style.setProperty("--road-glow", roadGlow.toFixed(4));
      root.style.setProperty("--near-blur", `${(2.8 - normalized * 1.8).toFixed(2)}px`);
      root.style.setProperty("--walk-bob", `${stride.toFixed(3)}px`);
      root.style.setProperty("--walk-sway", `${sway.toFixed(3)}px`);
      root.style.setProperty("--near-bob", `${(-stride * 0.3).toFixed(3)}px`);
      root.style.setProperty("--walk-pitch", `${walkPitch.toFixed(3)}deg`);
      root.style.setProperty("--step-zoom", stepZoom.toFixed(4));
      root.style.setProperty("--step-side", `${stepSide.toFixed(2)}px`);
      root.style.setProperty("--camera-roll", `${(walkRoll + currentLookX * 0.018).toFixed(3)}deg`);
      page.style.setProperty("--scene-progress", normalized.toFixed(4));

      const mission = normalized < 0.34 ? 0 : normalized < 0.68 ? 1 : 2;
      window.dispatchEvent(
        new CustomEvent("donghaeng:progress", {
          detail: { progress: normalized, mission },
        }),
      );

      if (!entered && normalized > 0.994 && targetProgress > 0.997) {
        entered = true;
        window.dispatchEvent(new CustomEvent("donghaeng:enter-demo"));
      }
    };

    const render = (timestamp: number) => {
      const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
      lastFrameTime = timestamp;
      const progressGap = targetProgress - currentProgress;
      if (reduceMotion) {
        currentProgress = targetProgress;
      } else {
        const maximumStep = 0.18 * deltaSeconds;
        currentProgress += Math.sign(progressGap) * Math.min(Math.abs(progressGap), maximumStep);
      }
      const isWalking = !reduceMotion && (Math.abs(progressGap) > 0.00015 || timestamp - lastScrollInput < 180);
      const targetStrength = isWalking ? 1 : 0;
      const response = Math.min(1, deltaSeconds * (isWalking ? 9 : 5));
      walkStrength += (targetStrength - walkStrength) * response;
      const direction = Math.sign(progressGap) || 1;
      gaitPhase += deltaSeconds * Math.PI * 2 * (1 / 1.2) * walkStrength * direction;
      currentLookX += (targetLookX - currentLookX) * 0.055;
      currentLookY += (targetLookY - currentLookY) * 0.055;
      if (Math.abs(targetProgress - currentProgress) < 0.0001) currentProgress = targetProgress;
      root.style.setProperty("--look-x", `${currentLookX.toFixed(2)}px`);
      root.style.setProperty("--look-y", `${currentLookY.toFixed(2)}px`);
      root.style.setProperty("--look-far-x", `${(-currentLookX * 0.35).toFixed(2)}px`);
      root.style.setProperty("--look-far-y", `${(-currentLookY * 0.25).toFixed(2)}px`);
      root.style.setProperty("--look-road-x", `${(-currentLookX * 0.12).toFixed(2)}px`);
      root.style.setProperty("--look-mid-x", `${(-currentLookX * 0.2).toFixed(2)}px`);
      root.style.setProperty("--look-mid-y", `${(-currentLookY * 0.2).toFixed(2)}px`);
      root.style.setProperty("--look-interior-x", `${(-currentLookX * 0.28).toFixed(2)}px`);
      root.style.setProperty("--look-interior-y", `${(-currentLookY * 0.22).toFixed(2)}px`);
      root.style.setProperty("--look-near-x", `${(currentLookX * 1.1).toFixed(2)}px`);
      updateJourney(currentProgress, gaitPhase, walkStrength);
      frame = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (reduceMotion || event.pointerType === "touch") return;
      targetLookX = ((event.clientX / window.innerWidth) * 2 - 1) * -2.3;
      targetLookY = ((event.clientY / window.innerHeight) * 2 - 1) * -1.1;
    };

    const resetPointer = () => {
      targetLookX = 0;
      targetLookY = 0;
    };

    const scrollTrigger = ScrollTrigger.create({
      trigger: page,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        targetProgress = self.progress;
        lastScrollInput = performance.now();
      },
    });

    frame = window.requestAnimationFrame(render);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", resetPointer);

    return () => {
      window.cancelAnimationFrame(frame);
      scrollTrigger.kill();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", resetPointer);
      root.style.removeProperty("--scene-progress");
      root.style.removeProperty("--interior-reveal");
      root.style.removeProperty("--arrival-glow");
      root.style.removeProperty("--road-glow");
      root.style.removeProperty("--near-blur");
      root.style.removeProperty("--walk-bob");
      root.style.removeProperty("--walk-sway");
      root.style.removeProperty("--near-bob");
      root.style.removeProperty("--walk-pitch");
      root.style.removeProperty("--step-zoom");
      root.style.removeProperty("--step-side");
      root.style.removeProperty("--camera-roll");
      root.style.removeProperty("--look-x");
      root.style.removeProperty("--look-y");
      root.style.removeProperty("--look-far-x");
      root.style.removeProperty("--look-far-y");
      root.style.removeProperty("--look-road-x");
      root.style.removeProperty("--look-mid-x");
      root.style.removeProperty("--look-mid-y");
      root.style.removeProperty("--look-interior-x");
      root.style.removeProperty("--look-interior-y");
      root.style.removeProperty("--look-near-x");
      page.style.removeProperty("--scene-progress");
    };
  }, []);

  return (
    <div ref={rootRef} className="alley-hope-journey" aria-hidden="true">
      <div className="alley-hope-road" />
      <div className="alley-hope-destination-light" />
      <div className="alley-hope-road-light"><i /></div>
      <div className="alley-hope-threshold" />
      <div className="alley-hope-interior" />
      <div className="alley-hope-near-field" />
      <div className="alley-hope-body-shadow" />
    </div>
  );
}
