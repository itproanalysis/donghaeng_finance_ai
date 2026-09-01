"use client";

import { type CSSProperties, useEffect, useState } from "react";

const columns = 18;
const rows = 12;
const maxEdgeDistance = Math.floor((rows - 1) / 2);

type MosaicCurtainProps = {
  mode: "cover" | "reveal";
  active?: boolean;
};

export default function MosaicCurtain({ mode, active = true }: MosaicCurtainProps) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode !== "reveal") return;
    const timer = window.setTimeout(() => setDone(true), 1250);
    return () => window.clearTimeout(timer);
  }, [mode]);

  return (
    <div
      className={`mosaic-curtain is-${mode}${active ? " is-active" : ""}${done ? " is-done" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: columns * rows }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const edgeDistance = Math.min(row, rows - 1 - row, column, columns - 1 - column);
        const variation = ((row * 17 + column * 29) % 5) * 12;
        const style = {
          "--cover-delay": `${edgeDistance * 126 + variation}ms`,
          "--reveal-delay": `${(maxEdgeDistance - Math.min(maxEdgeDistance, edgeDistance)) * 82 + variation}ms`,
          "--tile-tone": (row + column) % 9 === 0 ? "#efe9e3" : "#f9f8f6",
        } as CSSProperties;

        return <span className="mosaic-curtain-tile" style={style} key={index} />;
      })}
    </div>
  );
}
