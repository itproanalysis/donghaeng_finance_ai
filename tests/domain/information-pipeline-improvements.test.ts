import { describe, expect, it } from "vitest";

import {
  alignEvidenceSpan,
  calculateLiveFeatures,
  createDevV1RequiredInformationItems,
  parseCanonicalInformation,
  selectNextQuestion,
  type CanonicalInformationRecord,
} from "../../src/domain";

describe("Information Data Pipeline Improvements", () => {
  describe("Evidence Span Realignment (alignEvidenceSpan)", () => {
    it("realigns evidence span correctly when exact substring match exists in corrected text", () => {
      const text = "저희 가게 월평균 매출은 3000만원 정도 됩니다.";
      const originalSpan = { start: 99, end: 110, text: "3000만원" };
      const aligned = alignEvidenceSpan(text, originalSpan);
      expect(aligned).toEqual({
        start: 14,
        end: 20,
        text: "3000만원",
      });
    });

    it("falls back gracefully when text is empty or span text is not found", () => {
      const emptyAligned = alignEvidenceSpan("", { start: 0, end: 5, text: "abc" });
      expect(emptyAligned).toEqual({ start: 0, end: 0, text: "" });

      const notFoundText = "완전히 다른 문장입니다.";
      const notFoundSpan = { start: 10, end: 20, text: "매출" };
      const fallbackAligned = alignEvidenceSpan(notFoundText, notFoundSpan);
      expect(fallbackAligned).toEqual({
        start: 0,
        end: notFoundText.length,
        text: notFoundText,
      });
    });
  });

  describe("Parser Evidence Alignment", () => {
    it("ensures parseCanonicalInformation produces aligned evidence span", () => {
      const text = "최근 3개월 월평균 매출은 2500만원입니다.";
      const result = parseCanonicalInformation("monthly_average_sales", text);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.evidenceSpan.start).toBeGreaterThanOrEqual(0);
        expect(result.evidenceSpan.end).toBeLessThanOrEqual(text.length);
        expect(text.slice(result.evidenceSpan.start, result.evidenceSpan.end)).toBe(
          result.evidenceSpan.text,
        );
      }
    });
  });

  describe("Conflict Prioritization in Question Selector", () => {
    it("prioritizes a persisted CONFLICT status over standard NEEDED items", () => {
      const items = createDevV1RequiredInformationItems().map((item) => ({
        ...item,
        valueState: "MISSING" as const,
        value: null,
        quality: null,
        extractionConfidence: null,
        verification: null,
        evidenceIds: [],
        prefill: null,
        updatedAt: "2026-08-12T00:00:00.000Z",
      }));
      const salesItem = items.find((i) => i.infoCode === "monthly_average_sales");
      if (salesItem) {
        salesItem.status = "CONFLICT";
      }

      const nextQuestion = selectNextQuestion(items);
      expect(nextQuestion).not.toBeNull();
      expect(nextQuestion?.infoCode).toBe("monthly_average_sales");
      expect(nextQuestion?.reason).toBe("CONFLICT");
    });
  });

  describe("Feature Engine Conflicting Input Handling", () => {
    it("sets feature state to CONFLICTING when source record is in conflict", () => {
      const records: CanonicalInformationRecord[] = [
        {
          infoCode: "monthly_average_sales",
          category: "CURRENT_STATE",
          required: true,
          priority: "P0",
          minQuality: "MEDIUM",
          status: "CONFLICT",
          valueState: "UNKNOWN",
          selectedRevisionId: "rev-1",
          revisions: [
            {
              id: "rev-1",
              infoCode: "monthly_average_sales",
              revision: 1,
              valueState: "UNKNOWN",
              value: null,
              quality: null,
              parserConfidence: null,
              verification: "CONFLICTING",
              evidenceIds: [],
              observedAt: new Date().toISOString(),
              status: "CONFLICTING",
              supersedesRevisionId: null,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
      ];

      const liveFeatures = calculateLiveFeatures({
        records,
        stateVersion: 1,
      });

      const salesFeature = liveFeatures.features.find(
        (f) => f.name === "monthly_average_sales",
      );
      expect(salesFeature?.state).toBe("CONFLICTING");
      expect(salesFeature?.reason).toContain("CONFLICTING");
    });
  });
});
