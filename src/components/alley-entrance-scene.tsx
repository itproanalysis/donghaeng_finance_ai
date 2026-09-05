"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/** Scenery only. Interview data and navigation belong to the live service. */
export function AlleyEntranceScene() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const stage = scene?.parentElement;
    if (!scene || !stage) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      scene.style.setProperty("--alley-look-x", `${x}px`);
      scene.style.setProperty("--alley-look-y", `${y}px`);
      frame = 0;
    };
    const queuePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const reset = () => { x = 0; y = 0; queuePaint(); };
    const move = (event: PointerEvent) => {
      if (reducedMotion.matches || !finePointer.matches) return;
      const bounds = stage.getBoundingClientRect();
      x = ((event.clientX - bounds.left) / bounds.width - 0.5) * -10;
      y = ((event.clientY - bounds.top) / bounds.height - 0.5) * -6;
      queuePaint();
    };
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", reset);
    reducedMotion.addEventListener("change", reset);
    finePointer.addEventListener("change", reset);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", reset);
      reducedMotion.removeEventListener("change", reset);
      finePointer.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div className="entrance-scenery" ref={sceneRef} aria-hidden="true">
      <Image className="entrance-scene__image" src="/korean-alley-cafe-integrated-8k.webp" fill priority sizes="100vw" alt="" />
    </div>
  );
}
