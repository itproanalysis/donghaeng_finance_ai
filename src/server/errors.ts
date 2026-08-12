export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export class InterviewNotFoundError extends ApplicationError {
  constructor(id: string) {
    super(404, "INTERVIEW_NOT_FOUND", "인터뷰를 찾을 수 없습니다.", { id });
  }
}

export class EvaluationNotFoundError extends ApplicationError {
  constructor(id: string) {
    super(404, "EVALUATION_NOT_FOUND", "인터뷰 평가를 찾을 수 없습니다.", { id });
  }
}
