import { describe, expect, it } from "vitest";

import type { PillarView } from "../../src/components/api-adapter";
import { comparePillarCoverageSnapshots } from "../../src/components/pillar-coverage-preview";

const pillar = (
  key: PillarView["key"],
  confirmationRate: number | null,
  evaluableRate: number | null,
): PillarView => ({
  key,
  label: key,
  shortDescription: "server coverage",
  confirmationRate,
  evaluableRate,
  total: 2,
  resolved: 1,
});

describe("4 pillar data-quality PREVIEW", () => {
  it("copies each pillar's previous and current server rates without deriving a score", () => {
    const changes = comparePillarCoverageSnapshots(
      [
        pillar("CURRENT_STATE", 25, 25),
        pillar("FUTURE_OUTLOOK", 0, null),
        pillar("IMPROVEMENT_INTENT", 50, 50),
        pillar("HOUSEHOLD_STATE", 0, 0),
      ],
      [
        pillar("CURRENT_STATE", 50, 50),
        pillar("FUTURE_OUTLOOK", 0, null),
        pillar("IMPROVEMENT_INTENT", 100, 50),
        pillar("HOUSEHOLD_STATE", 0, 0),
      ],
    );

    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatchObject({
      key: "CURRENT_STATE",
      previousConfirmationRate: 25,
      currentConfirmationRate: 50,
      previousEvaluableRate: 25,
      currentEvaluableRate: 50,
      changed: true,
    });
    expect(changes[1]).toMatchObject({
      key: "FUTURE_OUTLOOK",
      previousEvaluableRate: null,
      currentEvaluableRate: null,
      changed: false,
    });
    expect(changes[2]).toMatchObject({
      key: "IMPROVEMENT_INTENT",
      previousConfirmationRate: 50,
      currentConfirmationRate: 100,
      previousEvaluableRate: 50,
      currentEvaluableRate: 50,
      changed: true,
    });
    expect(changes[3].changed).toBe(false);
  });

  it("does not invent a previous value for a pillar absent from the earlier snapshot", () => {
    expect(comparePillarCoverageSnapshots(
      [pillar("CURRENT_STATE", 0, 0)],
      [
        pillar("CURRENT_STATE", 50, 50),
        pillar("HOUSEHOLD_STATE", 0, 0),
      ],
    )).toEqual([
      expect.objectContaining({ key: "CURRENT_STATE", changed: true }),
    ]);
  });
});
