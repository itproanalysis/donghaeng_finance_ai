import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import type { GoalSnapshot } from "@/domain/goals";
import type { CanonicalInformationRecord } from "@/domain/information-values";
import { buildModelingInterviewAnswers } from "@/domain/modeling-interview-mapping";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";

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
  SCENARIO_NOT_LINKED: "이 상담에는 평가할 거래자료가 연결되어 있지 않습니다. 합성 자료를 사용하는 평가 시연에서 계산 과정을 확인할 수 있습니다.",
  PIPELINE_BUSY: "다른 평가를 계산 중입니다. 잠시 후 다시 시도해 주세요.",
  PYTHON_NOT_CONFIGURED:
    "평가 계산 환경이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
  BASE_CASE_NOT_CONFIGURED:
    "이 인터뷰에 연결된 거래 데이터가 없어 점수를 계산하지 않았습니다.",
  BASE_CASE_MISSING:
    "평가에 사용할 거래자료를 불러오지 못했습니다.",
  PIPELINE_FAILED: "평가 결과를 계산하지 못했습니다. 잠시 후 다시 시도해 주세요.",
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
  scenarioId?: string | null;
  industryCode: string;
  informationItems: readonly CanonicalInformationRecord[];
  goalSnapshot: GoalSnapshot;
}

export async function computeModelingScorecard(
  input: ModelingScorecardInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ModelingScorecardResult> {
  if (input.scenarioId !== OPERATING_DAY_DEMO_SCENARIO.id
    || input.industryCode !== OPERATING_DAY_DEMO_SCENARIO.persona.industryCode) return unavailable("SCENARIO_NOT_LINKED");
  const interpreter = environment.DONGHAENG_MODELING_PYTHON?.trim();
  if (!interpreter) return unavailable("PYTHON_NOT_CONFIGURED");

  const baseCase = environment.DONGHAENG_MODELING_BASE_CASE?.trim();
  if (!baseCase) return unavailable("BASE_CASE_NOT_CONFIGURED");

  // Runtime fixtures and temporary files are copied by Docker, not bundled by Next.
  const projectRoot = process.cwd();
  const baseDirectory = resolve(/* turbopackIgnore: true */ projectRoot, baseCase);
  if (!existsSync(/* turbopackIgnore: true */ baseDirectory)) return unavailable("BASE_CASE_MISSING");
  if (TRANSACTION_FILES.some((file) => !existsSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ baseDirectory, file)))) {
    return unavailable("BASE_CASE_MISSING");
  }

  const caseId = `case_live_${safeSegment(input.evaluationId)}`;
  const answers = buildModelingInterviewAnswers({
    industryCode: input.industryCode,
    informationItems: input.informationItems,
    goalSnapshot: input.goalSnapshot,
  });

  const cacheKey = createHash("sha256").update(JSON.stringify([interpreter, baseDirectory, input.evaluationId, answers])).digest("hex");
  const cached = completed.get(cacheKey);
  if (cached) return cached;
  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;
  if (pending.size >= 2) return unavailable("PIPELINE_BUSY");
  const run = runScorecard(interpreter, projectRoot, baseDirectory, caseId, answers, environment);
  pending.set(cacheKey, run);
  try {
    const result = await run;
    if (result.status === "READY") {
      if (completed.size >= 100) completed.delete(completed.keys().next().value!);
      completed.set(cacheKey, result);
    }
    return result;
  } finally { pending.delete(cacheKey); }
}

const completed = new Map<string, ModelingScorecardResult>();
const pending = new Map<string, Promise<ModelingScorecardResult>>();

async function runScorecard(interpreter: string, projectRoot: string, baseDirectory: string, caseId: string,
  answers: Record<string, unknown>, environment: NodeJS.ProcessEnv): Promise<ModelingScorecardResult> {
  const temporaryRoot = resolve(/* turbopackIgnore: true */ tmpdir());
  let caseDirectory: string | null = null;
  const requestedTimeout = Number(environment.DONGHAENG_MODELING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 30_000) : DEFAULT_TIMEOUT_MS;
  try {
    caseDirectory = mkdtempSync(join(/* turbopackIgnore: true */ temporaryRoot, "donghaeng-scorecard-"));
    for (const file of TRANSACTION_FILES) copyFileSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ baseDirectory, file), join(/* turbopackIgnore: true */ caseDirectory, file));
    writeFileSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ caseDirectory, "interview.json"), JSON.stringify(answers), "utf8");
    const { stdout } = await execFileAsync(interpreter, ["-m", "modeling.scorecard", "--case-dir", caseDirectory, caseId], {
      cwd: projectRoot, timeout, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1", OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" },
    });
    const scorecard = JSON.parse(stdout) as ModelingScorecardPayload;
    for (const axis of [scorecard.current_situation, scorecard.improvement]) {
      if (!axis || !Array.isArray(axis.items) || axis.items.length !== 5) throw new Error("Invalid scorecard");
      const included = axis.items.filter((item) => !item.excluded);
      const points = included.reduce((sum, item) => sum + (item.points ?? 0), 0);
      if (included.length !== axis.items_used || axis.items_total !== 5
        || typeof axis.score !== "number" || !Number.isFinite(axis.score)
        || Math.abs(axis.score - points / (included.length * 20) * 100) > 1e-6) throw new Error("Score accounting mismatch");
    }
    return { status: "READY", unavailableReason: null, unavailableMessage: null, scorecard,
      reproduceCommand: null, transactionDataSource: "영업일 감소 합성 사례 · 동일 거래자료 + 확인 완료한 답변" };
  } catch { return unavailable("PIPELINE_FAILED"); }
  finally {
    if (caseDirectory && dirname(resolve(/* turbopackIgnore: true */ caseDirectory)) === temporaryRoot && basename(caseDirectory).startsWith("donghaeng-scorecard-")) {
      rmSync(/* turbopackIgnore: true */ caseDirectory, { recursive: true, force: true });
    }
  }
}
