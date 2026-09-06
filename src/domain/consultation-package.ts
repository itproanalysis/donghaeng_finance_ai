import type { DataReview } from "./data-review";
import type { RecoveryState } from "./recovery-journey";
import type { ConsultationDraftRecord } from "./consultation-draft";
import type { INSTITUTION_DIRECTORY } from "./consultation-institutions";

export interface ConsultationPackage {
  schemaVersion: "institution_consultation_v1";
  preparedAt: string;
  environment: "SYNTHETIC_DEMO" | "WORKSPACE";
  deliveryStatus: "NOT_SENT";
  canEditDraft: boolean;
  review: DataReview;
  recovery: RecoveryState;
  draft: ConsultationDraftRecord | null;
  institutions: typeof INSTITUTION_DIRECTORY;
}
