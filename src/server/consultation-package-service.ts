import type { DatabaseSync } from "node:sqlite";
import type { Principal } from "./auth";
import type { InterviewService } from "./interview-service";
import type { ConsultationPackage } from "@/domain/consultation-package";
import { INSTITUTION_DIRECTORY } from "@/domain/consultation-institutions";
import { ConsultationDraftService } from "./consultation-draft-service";
import { RecoveryService } from "./recovery-service";
import { InterviewRepository } from "./interview-repository";
import { ApplicationError } from "./errors";
import { isPublicReviewMode } from "./public-review";

export class ConsultationPackageService {
  constructor(private readonly database: DatabaseSync, private readonly interviews: InterviewService) {}
  get(interviewId: string, principal: Principal): ConsultationPackage {
    return new InterviewRepository(this.database).transaction(() => {
      const review = this.interviews.getDataReview(interviewId, principal);
      if (review.snapshotType !== "FINAL") throw new ApplicationError(409, "FINAL_REQUIRED", "답변을 확인하고 인터뷰를 마친 뒤 상담 준비서를 만들 수 있습니다.");
      const canEditDraft = principal.roles.some((role) => ["ADMIN", "INTERVIEWER"].includes(role));
      return {
        schemaVersion: "institution_consultation_v1", preparedAt: new Date().toISOString(), deliveryStatus: "NOT_SENT", canEditDraft,
        environment: isPublicReviewMode() ? "SYNTHETIC_DEMO" : "WORKSPACE",
        review, recovery: new RecoveryService(this.database, this.interviews).get(interviewId, principal),
        // Retain existing operator-only draft access. Borrowers can export their own source record.
        draft: canEditDraft ? new ConsultationDraftService(this.database).get(interviewId, principal) : null,
        institutions: INSTITUTION_DIRECTORY,
      };
    });
  }
}
