/**
 * 인터뷰 결과를 modeling 파이프라인이 읽는 케이스 폴더로 옮긴다.
 *
 * 거래 데이터는 만들지 않고 기준 케이스에서 복사하며, interview.json만 인터뷰
 * 결과로 바꾼다. 점수 계산은 하지 않는다. 계산은 `python -m modeling.scorecard`가
 * 그대로 맡는다.
 *
 * 결과 폴더는 data/mock 밖에 둔다. validate가 data/mock 목록과 케이스 10개를
 * 대조하므로 여기에 섞이면 검증이 깨진다.
 *
 *   tsx scripts/scenario-to-modeling.mjs --snapshot final.json --out data/live-cases/x
 *   tsx scripts/scenario-to-modeling.mjs --scenario operating-day --set primary --out data/live-cases/y
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createDevV1ScenarioRequiredInformationItems } from "../src/domain/information-catalog.ts";
import { parseCanonicalInformation } from "../src/domain/information-parsers.ts";
import { findDemoScenario } from "../src/domain/demo-scenario.ts";
import { buildModelingInterviewAnswers } from "../src/domain/modeling-interview-mapping.ts";

const projectRoot = resolve(import.meta.dirname, "..");

/** 인터뷰가 만들지 않는 거래·서류·조회 파일. 기준 케이스에서 그대로 가져온다. */
const TRANSACTION_FILES = [
  "account_meta.json",
  "account_tx.csv",
  "card_sales.csv",
  "card_spend.csv",
  "cb.json",
  "docs.json",
];

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`알 수 없는 인자입니다: ${key}`);
    options[key.slice(2)] = argv[index + 1];
  }
  return options;
}

/**
 * 대본에서 직접 기록을 만든다. 서버 없이 매핑과 점수를 확인할 때 쓰고, 실제
 * 시연은 --snapshot 경로로 서버가 만든 FINAL을 읽는다.
 */
function recordsFromScenario(scenario, answerSet) {
  const items = createDevV1ScenarioRequiredInformationItems(scenario.triggeredInfoCodes);
  const records = [];
  for (const item of items) {
    const answer = answerSet.answers[item.infoCode];
    if (!answer) continue;
    const candidate = parseCanonicalInformation(item.infoCode, answer);
    if (!candidate) continue;
    const revisionId = `${item.infoCode}-r1`;
    records.push({
      infoCode: item.infoCode,
      category: item.category,
      required: item.required,
      priority: item.priority,
      minQuality: item.minQuality,
      status: candidate.proposedStatus,
      valueState: candidate.valueState,
      selectedRevisionId: revisionId,
      revisions: [
        {
          id: revisionId,
          infoCode: item.infoCode,
          revision: 1,
          valueState: candidate.valueState,
          value: candidate.value,
          quality: candidate.quality,
          parserConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [],
          observedAt: "2026-09-05T00:00:00.000Z",
          status: "SELECTED",
          supersedesRevisionId: null,
        },
      ],
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
  }
  return records;
}

/**
 * 대본에서 만들 때의 목표. 개선 계획 parser가 뽑은 값을 그대로 옮기고, 값이
 * 없으면 목표를 만들지 않는다.
 */
function goalFromRecords(records) {
  const plan = records.find((record) => record.infoCode === "improvement_plan");
  const value = plan?.revisions.at(-1)?.value;
  const target = value?.kind === "IMPROVEMENT_PLAN" ? value.target : null;
  const baseline = value?.kind === "IMPROVEMENT_PLAN" ? value.baseline : null;
  const schedule = value?.kind === "IMPROVEMENT_PLAN" ? value.schedule : null;
  const period =
    schedule && schedule.duration.kind === "EXACT"
      ? { value: schedule.duration.value, unit: schedule.unit }
      : null;
  return {
    policyVersion: "dev-v1",
    status: target ? "CONFIRMED" : "NO_GOAL_STATED",
    numericStatus: target ? "DIRECT" : "NOT_APPLICABLE",
    title: target ? "인터뷰에서 확인한 목표" : null,
    origin: target ? "BORROWER_STATED" : null,
    baseline,
    target,
    period,
    unit: target?.unit ?? null,
    measurementSources:
      value?.kind === "IMPROVEMENT_PLAN" ? [...value.measurementSources] : [],
    context: null,
    behaviorEvent: null,
    evidenceIds: [],
    missingFields: [],
  };
}

function writeCase(outputDirectory, baseCaseDirectory, answers) {
  if (!existsSync(baseCaseDirectory)) {
    throw new Error(
      `기준 케이스가 없습니다: ${baseCaseDirectory}. 먼저 python -m modeling.make_mock을 실행하세요.`,
    );
  }
  mkdirSync(outputDirectory, { recursive: true });
  for (const file of TRANSACTION_FILES) {
    const source = join(baseCaseDirectory, file);
    if (!existsSync(source)) throw new Error(`기준 케이스에 ${file}이 없습니다.`);
    copyFileSync(source, join(outputDirectory, file));
  }
  writeFileSync(
    join(outputDirectory, "interview.json"),
    `${JSON.stringify(answers, null, 2)}\n`,
    "utf8",
  );
}

export function buildScenarioCase({ scenarioId, answerSetId, outputDirectory, baseCaseDirectory }) {
  const scenario = findDemoScenario(scenarioId);
  if (!scenario) throw new Error(`등록되지 않은 시나리오입니다: ${scenarioId}`);
  const answerSet = answerSetId === "control" ? scenario.control : scenario.primary;
  const records = recordsFromScenario(scenario, answerSet);
  const answers = buildModelingInterviewAnswers({
    industryCode: scenario.persona.industryCode,
    informationItems: records,
    goalSnapshot: goalFromRecords(records),
  });
  const base = baseCaseDirectory ?? join(projectRoot, "data", "mock", answerSet.modelingCaseId);
  writeCase(outputDirectory, base, answers);
  return answers;
}

export function buildSnapshotCase({ snapshotPath, outputDirectory, baseCaseDirectory }) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  if (snapshot.snapshotType !== "FINAL") {
    throw new Error("FINAL snapshot만 옮길 수 있습니다.");
  }
  const answers = buildModelingInterviewAnswers({
    industryCode: snapshot.business?.industry ?? "",
    informationItems: snapshot.informationItems ?? [],
    goalSnapshot: snapshot.goalSnapshot,
  });
  writeCase(outputDirectory, baseCaseDirectory, answers);
  return answers;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.out) throw new Error("--out 경로가 필요합니다.");
  const outputDirectory = resolve(projectRoot, options.out);

  const answers = options.snapshot
    ? buildSnapshotCase({
        snapshotPath: resolve(projectRoot, options.snapshot),
        outputDirectory,
        baseCaseDirectory: resolve(
          projectRoot,
          options.base ?? join("data", "mock", "case_operating_drop"),
        ),
      })
    : buildScenarioCase({
        scenarioId: options.scenario ?? "operating-day",
        answerSetId: options.set ?? "primary",
        outputDirectory,
        baseCaseDirectory: options.base ? resolve(projectRoot, options.base) : null,
      });

  process.stdout.write(`${JSON.stringify(answers, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main();
}
