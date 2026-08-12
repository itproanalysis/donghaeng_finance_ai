import { describe, expect, it } from "vitest";

import { adaptLiveSnapshot } from "../../src/components/api-adapter";

describe("acceptance workspace adapter contract", () => {
  it("preserves required flags, borrower-confirmed evidence, unresolved required count and live goal", () => {
    const live = adaptLiveSnapshot({
      session: {
        id: "acceptance-live",
        lifecycleStatus: "ACTIVE",
        version: 3,
        lastEventSeq: 12,
        updatedAt: "2026-08-10T00:03:00.000Z",
      },
      borrower: { name: "김동행" },
      business: { businessName: "동행 카페", industry: "카페" },
      informationItems: [
        {
          infoCode: "monthly_average_sales",
          label: "월평균 매출",
          category: "CURRENT_STATE",
          priority: "P1",
          required: true,
          status: "NEEDED",
          valueState: "PRESENT",
          value: { amount: 21_000_000, currency: "KRW", period: "MONTH" },
          quality: "HIGH",
          verification: "TRANSACTION_SUPPORTED",
          evidenceIds: ["borrower-sales"],
        },
        {
          infoCode: "platform_fee_pressure",
          label: "플랫폼 비용부담",
          category: "CURRENT_STATE",
          priority: "P0",
          required: false,
          status: "CONFIRMED",
          valueState: "PRESENT",
          value: {
            kind: "BUSINESS_SIGNAL",
            signal: "PLATFORM_FEE_PRESSURE",
            observed: true,
          },
          evidenceIds: ["borrower-1"],
        },
      ],
      transcript: [],
      evidence: [
        {
          id: "borrower-1",
          infoCode: "platform_fee_pressure",
          kind: "SELF_REPORTED",
          source: "borrower_transcript",
          transcriptSegmentId: "segment-1",
          excerpt: "플랫폼 수수료가 부담됩니다.",
          observedAt: "2026-08-10T00:00:00.000Z",
        },
        {
          id: "borrower-sales",
          infoCode: "monthly_average_sales",
          kind: "SELF_REPORTED",
          source: "borrower_transcript",
          transcriptSegmentId: "segment-2",
          excerpt: "최근 3개월 월평균 매출은 2,100만원입니다.",
          observedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
      coverage: {
        byCategory: {},
        totalRequired: 8,
        resolvedRequired: 0,
        unresolvedP0: 3,
        overallRate: 0,
        requiredInformationRate: 0,
      },
      nextQuestion: {
        infoCode: "platform_fee_pressure",
        text: "최근 카드 매출이 약 10% 감소했습니다. 가장 큰 이유가 무엇인가요?",
        reason: "P0",
      },
      goalSnapshot: {
        status: "CONFIRMED",
        numericStatus: "DIRECT",
        title: "단골 전화주문 확대",
        baseline: { value: { kind: "EXACT", value: 18 }, unit: "%" },
        target: { value: { kind: "EXACT", value: 30 }, unit: "%" },
        period: { value: 8, unit: "WEEK" },
        unit: "%",
        measurementSources: ["PHONE_ORDER_LOG", "POS"],
        origin: "BORROWER_STATED",
        context: "플랫폼 비용 절감",
        behaviorEvent: {
          eventName: "goal_measurement:PHONE_ORDER_LOG",
          window: "8 WEEK",
          metric: "%",
          aggregation: "SUM",
          source: "PHONE_ORDER_LOG",
        },
        evidenceIds: ["borrower-1"],
      },
    });

    expect(live.currentQuestion).toBe(
      "최근 카드 매출이 약 10% 감소했습니다. 가장 큰 이유가 무엇인가요?",
    );
    expect(live.informationItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          infoCode: "monthly_average_sales",
          required: true,
          status: "NEEDED",
          displayValue: "21,000,000원 / 월",
        }),
        expect.objectContaining({
          infoCode: "platform_fee_pressure",
          required: false,
        }),
      ]),
    );
    expect(live.unresolvedRequired).toBe(8);
    expect(live.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "borrower_transcript",
          observedAt: "2026-08-10T00:00:00.000Z",
        }),
        expect.objectContaining({
          source: "borrower_transcript",
          observedAt: "2026-08-10T00:00:00.000Z",
        }),
      ]),
    );
    expect(live.goal).toMatchObject({
      status: "CONFIRMED",
      baseline: "18%",
      target: "30%",
      period: "8주",
      measurementSource: "PHONE_ORDER_LOG, POS",
      behaviorEvent: { source: "PHONE_ORDER_LOG", window: "8주" },
    });
  });

  it("falls back to required flags instead of priority when coverage totals are absent", () => {
    const live = adaptLiveSnapshot({
      session: {
        id: "required-fallback",
        lifecycleStatus: "ACTIVE",
        version: 1,
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
      borrower: { name: "김동행" },
      business: { businessName: "동행 카페", industry: "카페" },
      informationItems: [
        {
          infoCode: "execution_readiness",
          category: "IMPROVEMENT_INTENT",
          priority: "P1",
          required: true,
          status: "NEEDED",
          valueState: "MISSING",
        },
        {
          infoCode: "repeat_customer_share",
          category: "CURRENT_STATE",
          priority: "P0",
          required: false,
          status: "NEEDED",
          valueState: "MISSING",
        },
      ],
      transcript: [],
      evidence: [],
      coverage: { byCategory: {} },
      nextQuestion: null,
    });

    expect(live.unresolvedRequired).toBe(1);
    expect(live.informationItems.filter((item) => !item.required)).toHaveLength(1);
  });
});
