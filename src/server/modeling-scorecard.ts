import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { GoalSnapshot } from "@/domain/goals";
import type { CanonicalInformationRecord } from "@/domain/information-values";
import { buildModelingInterviewAnswers } from "@/domain/modeling-interview-mapping";

const execFileAsync = promisify(execFile);

/**
 * 인터뷰 결과를 modeling 파이프라인에 넘겨 2축 점수를 받아온다.
 *
 * 점수 계산은 전부 `modeling/scorecard.py`가 하고 여기서는 값을 옮기고 실행만
 * 한다. 같은 규칙을 TS로 다시 구현하지 않는 이유는 두 곳이 어긋나면 문서와 실물이
 * 달라지기 때문이다.
 *
 * 인터프리터나 거래 데이터가 준비되지 않으면 점수를 추정해 채우지 않고 미연결
 * 상태를 그대로 돌려준다.
 */

export const MODELING_SCORECARD_UNAVAILABLE_REASONS = {
  PYTHON_NOT_CONFIGURED:
    "DONGHAENG_MODELING_PYTHON이 설정되지 않아 modeling 파이프라인을 실행하지 않았습니다.",
  BASE_CASE_NOT_CONFIGURED:
    "이 인터뷰에 연결된 거래 데이터가 없어 점수를 계산하지 않았습니다.",
  BASE_CASE_MISSING:
    "설정된 거래 데이터 폴더를 찾지 못했습니다. python -m modeling.make_mock을 먼저 실행하세요.",
  PIPELINE_FAILED: "modeling 파이프라인 실행이 실패했습니다.",
} as const;

export type ModelingScorecardUnavailableReason =
  keyof typeof MODELING_SCORECARD_UNAVAILABLE_REASONS;

export interface ModelingScorecardItem {
  name: string;
  points: number | null;
  excluded: boolean;
  band: string;
  note: string;
}

export interface ModelingScorecardAxis {
  score: number | string;
  items: ModelingScorecardItem[];
  items_used: number;
  items_total: number;
  basis: string;
  note: string;
}

export interface ModelingScorecardPayload {
  current_situation: ModelingScorecardAxis;
  improvement: ModelingScorecardAxis;
  case_id: string;
}

export interface ModelingScorecardResult {
  status: "READY" | "UNAVAILABLE";
  unavailableReason: ModelingScorecardUnavailableReason | null;
  unavailableMessage: string | null;
  scorecard: ModelingScorecardPayload | null;
  /** 화면이 그대로 보여줄 재현 명령 */
  reproduceCommand: string | null;
  /** 점수에 쓰인 거래 데이터의 출처. 지금은 mock 케이스다. */
  transactionDataSource: string | null;
}

/** 인터뷰가 만들지 않는 거래·서류·조회 파일 */
const TRANSACTION_FILES = [
  "account_meta.json",
  "account_tx.csv",
  "card_sales.csv",
  "card_spend.csv",
  "cb.json",
  "docs.json",
] as const;

const DEFAULT_TIMEOUT_MS = 20_000;

function unavailable(reason: ModelingScorecardUnavailableReason): ModelingScorecardResult {
  return {
    status: "UNAVAILABLE",
    unavailableReason: reason,
    unavailableMessage: MODELING_SCORECARD_UNAVAILABLE_REASONS[reason],
    scorecard: null,
    reproduceCommand: null,
    transactionDataSource: null,
  };
}

/** 경로에 쓸 수 있는 형태로만 남긴다. 사용자 입력이 폴더 경로를 벗어나지 않게 한다. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
}

export interface ModelingScorecardInput {
  evaluationId: string;
  industryCode: string;
  informationItems: readonly CanonicalInformationRecord[];
  goalSnapshot: GoalSnapshot;
}

export async function computeModelingScorecard(
  input: ModelingScorecardInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelingScorecardResult> {
  const interpreter = environment.DONGHAENG_MODELING_PYTHON?.trim();
  if (!interpreter) return unavailable("PYTHON_NOT_CONFIGURED");

  const baseCase = environment.DONGHAENG_MODELING_BASE_CASE?.trim();
  if (!baseCase) return unavailable("BASE_CASE_NOT_CONFIGURED");

  const projectRoot = process.cwd();
  const baseDirectory = resolve(projectRoot, baseCase);
  if (!existsSync(baseDirectory)) return unavailable("BASE_CASE_MISSING");
  if (TRANSACTION_FILES.some((file) => !existsSync(join(baseDirectory, file)))) {
    return unavailable("BASE_CASE_MISSING");
  }

  const caseId = `case_live_${safeSegment(input.evaluationId)}`;
  const caseDirectory = join(projectRoot, "data", "live-cases", caseId);
  const answers = buildModelingInterviewAnswers({
    industryCode: input.industryCode,
    informationItems: input.informationItems,
    goalSnapshot: input.goalSnapshot,
  });

  mkdirSync(caseDirectory, { recursive: true });
  for (const file of TRANSACTION_FILES) {
    copyFileSync(join(baseDirectory, file), join(caseDirectory, file));
  }
  writeFileSync(
    join(caseDirectory, "interview.json"),
    `${JSON.stringify(answers, null, 2)}\n`,
    "utf8",
  );

  const relativeCaseDirectory = `data/live-cases/${caseId}`;
  const reproduceCommand = `${interpreter} -m modeling.scorecard --case-dir ${relativeCaseDirectory}`;
  const timeout = Number(environment.DONGHAENG_MODELING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  try {
    const { stdout } = await execFileAsync(
      interpreter,
      ["-m", "modeling.scorecard", "--case-dir", relativeCaseDirectory, caseId],
      { cwd: projectRoot, timeout, maxBuffer: 4 * 1024 * 1024 },
    );
    return {
      status: "READY",
      unavailableReason: null,
      unavailableMessage: null,
      scorecard: JSON.parse(stdout) as ModelingScorecardPayload,
      reproduceCommand,
      transactionDataSource: baseCase,
    };
  } catch {
    return {
      ...unavailable("PIPELINE_FAILED"),
      reproduceCommand,
      transactionDataSource: baseCase,
    };
  }
}
