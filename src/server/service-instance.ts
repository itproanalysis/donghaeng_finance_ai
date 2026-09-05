import { createConfiguredAsyncInterviewTurnPlanner } from "@/ai/configured-interview-provider";

import { getDatabase } from "./database";
import { AuthService } from "./auth";
import { ConsentService } from "./consent-service";
import { InterviewRepository } from "./interview-repository";
import { InterviewService } from "./interview-service";
import { RetentionService } from "./retention-service";
import { assertApplicationAuthenticationAvailable } from "./production-auth-policy";
import { reserveReviewUsage } from "./public-review";

const globalServices = globalThis as typeof globalThis & {
  __donghaengInterviewService?: InterviewService;
  __donghaengAuthService?: AuthService;
  __donghaengRetentionService?: RetentionService;
};

export function getInterviewService(): InterviewService {
  assertApplicationAuthenticationAvailable();
  if (!globalServices.__donghaengInterviewService) {
    const asyncTurnPlanner = createConfiguredAsyncInterviewTurnPlanner();
    globalServices.__donghaengInterviewService = new InterviewService(
      new InterviewRepository(getDatabase()),
      asyncTurnPlanner
        ? {
            asyncTurnPlanner,
            beforeAsyncStage: ({ interviewId, principal }) => {
              new ConsentService(getDatabase()).assertEffectiveConsent(
                interviewId,
                "CLOUD_AI_PROCESSING",
                principal,
              );
            },
            beforeAsyncPlan: ({ interviewId, principal }) => {
              new ConsentService(getDatabase()).assertEffectiveConsent(
                interviewId,
                "CLOUD_AI_PROCESSING",
                principal,
              );
              reserveReviewUsage(getDatabase(), "ai", principal.tenantId);
            },
          }
        : {},
    );
  }
  return globalServices.__donghaengInterviewService;
}

export function getAuthService(): AuthService {
  assertApplicationAuthenticationAvailable();
  if (!globalServices.__donghaengAuthService) {
    globalServices.__donghaengAuthService = new AuthService(getDatabase());
  }
  return globalServices.__donghaengAuthService;
}

export function getRetentionService(): RetentionService {
  assertApplicationAuthenticationAvailable();
  if (!globalServices.__donghaengRetentionService) {
    globalServices.__donghaengRetentionService = new RetentionService(getDatabase());
  }
  return globalServices.__donghaengRetentionService;
}
