/**
 * 심사 시연 시나리오가 실물로 끝까지 도는지 판정한다.
 *
 * 서버를 띄우고 대본대로 인터뷰를 진행해 FINAL까지 만든 뒤, 그 결과로 modeling
 * 2축 점수를 받아 mock 케이스의 점수와 대조한다. 대조 인터뷰도 같은 방식으로
 * 돌려 답에 따라 점수가 달라지는지 본다.
 *
 * 이 스크립트는 판정만 한다. 실패하면 무엇이 어긋났는지 알리고 멈추며, 코드나
 * 대본을 고치지 않는다.
 *
 *   npx tsx scripts/verify-demo-scenario.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";

import { createBorrowerRequiredInformationList } from "../src/components/borrower-interview-preferences.ts";
import { OPERATING_DAY_DEMO_SCENARIO } from "../src/domain/demo-scenario.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const tsxCli = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const scenario = OPERATING_DAY_DEMO_SCENARIO;
const localWorkspacePassword = "verify-local-password";

let temporaryDirectory = null;
let applicationProcess = null;
let serverLog = "";
let providerStub = null;
const checks = [];

function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  process.stdout.write(`  [${passed ? "PASS" : "FAIL"}] ${name}${detail ? `  ${detail}` : ""}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function runProcess(command, arguments_, environment = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectRoot,
      env: { ...process.env, PYTHONUTF8: "1", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`실행 실패 (${code})\n${output}`)),
    );
  });
}

async function initializeLocalWorkspace(environment) {
  const initializer = [
    "import { getDatabase } from './src/server/database.ts';",
    "import { AuthService } from './src/server/auth.ts';",
    "const database = getDatabase();",
    "new AuthService(database).bootstrapLocalWorkspace();",
    "database.close();",
  ].join(" ");
  await runProcess(process.execPath, [tsxCli, "-e", initializer], {
    ...environment,
    NODE_ENV: "development",
  });
}

async function startServer(environment, origin) {
  // 실행 중인 개발 서버의 잠금을 건드리지 않고 프로덕션 산출물을 검증한다.
  applicationProcess = spawn(process.execPath, [tsxCli, "server.ts"], {
    cwd: projectRoot,
    env: { ...process.env, ...environment, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    serverLog = `${serverLog}${chunk.toString()}`.slice(-20_000);
  };
  applicationProcess.stdout.on("data", capture);
  applicationProcess.stderr.on("data", capture);

  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (applicationProcess.exitCode !== null) {
      throw new Error(`서버가 조기 종료됐습니다.\n${serverLog}`);
    }
    try {
      const response = await fetch(`${origin}/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // 서버가 아직 준비되지 않았다.
    }
    await delay(250);
  }
  throw new Error(`서버 준비 시간 초과\n${serverLog}`);
}

async function startProviderStub() {
  providerStub = createHttpServer((request, response) => {
    void (async () => {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; assert(bytes < 1_000_000, "stub request too large"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(request.method === "POST" && request.url === "/v1/messages", "unexpected stub request");
      const payload = JSON.parse(body.messages[0].content);
      const candidate = payload.allowedCandidates[0];
      assert(candidate && body.tools[0].input_schema.properties.selectedInfoCode.enum.includes(candidate.infoCode), "selected question missing from provider tool schema");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "message", role: "assistant", model: "claude-sonnet-5", stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 40 }, content: [{ type: "tool_use", id: `toolu_scenario_${Date.now()}`, name: body.tools[0].name, input: { selectedInfoCode: candidate.infoCode, reaction: "말씀하신 내용을 확인했어요.", question: "이어서 이 내용을 조금 더 여쭤봐도 될까요?" }, caller: { type: "direct" } }] }));
    })().catch((error) => { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error.message })); });
  });
  await new Promise((ready) => providerStub.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${providerStub.address().port}/v1/messages`;
}

async function stopServer() {
  const child = applicationProcess;
  applicationProcess = null;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

async function apiRequest(origin, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.mutationOrigin) headers.set("origin", options.mutationOrigin);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${origin}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function expectSuccess(result, status, label) {
  assert(
    result.response.status === status,
    `${label}: 예상 HTTP ${status}, 실제 ${result.response.status} ${JSON.stringify(result.payload)}`,
  );
  assert(result.payload?.error === null, `${label}: ${JSON.stringify(result.payload?.error)}`);
  return result.payload.data;
}

/** 대본대로 인터뷰를 끝까지 진행하고 FINAL 평가를 만든다. */
async function runInterview(origin, cookie, answerSet, label) {
  const created = expectSuccess(
    await apiRequest(origin, "/api/interviews", {
      method: "POST",
      cookie,
      mutationOrigin: origin,
      body: {
        industryCode: scenario.persona.industryCode,
        profile: {
          borrowerName: scenario.persona.borrowerName,
          businessName: scenario.persona.businessName,
        },
        requiredInformationList: createBorrowerRequiredInformationList(scenario.persona.industryCode, "FULL_REVIEW", scenario.id),
      },
    }),
    201,
    `${label} 인터뷰 생성`,
  );

  const interviewId = created.session.id;
  expectSuccess(await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/consents`, { method: "POST", cookie, mutationOrigin: origin, body: { purpose: "CLOUD_AI_PROCESSING", consentVersion: "cloud-ai-processing-v1", granted: true, expiresAt: null } }), 201, `${label} 동의`);
  let live = created;
  const askedInfoCodes = [];

  for (let turn = 0; turn < 24 && live.nextQuestion; turn += 1) {
    const infoCode = live.nextQuestion.infoCode;
    const answer = answerSet.answers[infoCode];
    assert(answer, `${label}: ${infoCode} 대본이 없습니다.`);
    askedInfoCodes.push(infoCode);
    const result = expectSuccess(
      await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: {
          text: answer,
          clientMessageId: `${answerSet.id}-${turn + 1}`,
          expectedVersion: live.session.version,
          currentQuestionInfoCode: infoCode,
        },
      }),
      200,
      `${label} ${infoCode} 답변`,
    );
    live = result.snapshot;
  }

  assert(live.nextQuestion === null, `${label}: 인터뷰가 끝나지 않았습니다.`);

  const completed = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/complete`, {
      method: "POST",
      cookie,
      mutationOrigin: origin,
      body: {
        clientCommandId: `${answerSet.id}-complete`,
        expectedVersion: live.session.version,
        mode: "COMPLETE",
        borrowerConfirmed: true,
        reason: null,
      },
    }),
    200,
    `${label} 완료`,
  );

  return { interviewId, live, completed, askedInfoCodes };
}

async function readScorecard(origin, cookie, evaluationId, label) {
  return expectSuccess(
    await apiRequest(
      origin,
      `/api/interview-evaluations/${encodeURIComponent(evaluationId)}/scorecard`,
      { cookie },
    ),
    200,
    `${label} 스코어카드`,
  );
}

function axisScores(scorecard) {
  return {
    current: scorecard?.current_situation?.score ?? null,
    improvement: scorecard?.improvement?.score ?? null,
  };
}

async function mockScores(pythonPath, caseId) {
  const output = await runProcess(pythonPath, ["-m", "modeling.scorecard", caseId, "--json"]);
  return axisScores(JSON.parse(output));
}

async function main() {
  const pythonPath = process.env.DONGHAENG_MODELING_PYTHON
    ?? [resolve(projectRoot, ".venv", "Scripts", "python.exe"), resolve(projectRoot, ".venv", "bin", "python")].find(existsSync)
    ?? spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } }).stdout?.trim();
  assert(existsSync(pythonPath), `modeling 인터프리터를 찾지 못했습니다: ${pythonPath}`);
  assert(
    existsSync(resolve(projectRoot, "data", "mock", scenario.primary.modelingCaseId)),
    "기준 케이스가 없습니다. python -m modeling.make_mock을 먼저 실행하세요.",
  );

  const liveFlag = process.argv.indexOf("--public-live");
  let origin;
  let cookie;
  if (liveFlag >= 0) {
    origin = process.argv[liveFlag + 1];
    assert(/^https:\/\/donghaeng-finance-review-[a-z0-9.-]+\.run\.app$/.test(origin ?? ""), "Explicit isolated public review URL required");
    process.stdout.write(`공개 서비스 실제 공급자 검증: ${origin}\n`);
    const visitor = await apiRequest(origin, "/api/auth/visitor-session", { method: "POST", mutationOrigin: origin, body: {} });
    expectSuccess(visitor, 200, "방문자 세션");
    cookie = visitor.response.headers.get("set-cookie").split(";", 1)[0];
  } else {
    temporaryDirectory = mkdtempSync(join(projectRoot, "data", "verify-"));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const providerEndpoint = await startProviderStub();
    const environment = {
      DONGHAENG_HOST: "127.0.0.1",
      DONGHAENG_PORT: String(port),
      DONGHAENG_APP_ORIGIN: origin,
      DONGHAENG_E2E_AUTH_ALLOW_LOCAL: "1",
      DONGHAENG_DB_PATH: join(temporaryDirectory, "verify.db"),
      DONGHAENG_LOCAL_BOOTSTRAP: "1",
      DONGHAENG_LOCAL_PASSWORD: localWorkspacePassword,
      DONGHAENG_ORCHESTRATOR_PROVIDER: "anthropic",
      DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
      DONGHAENG_ANTHROPIC_ENDPOINT: providerEndpoint,
      ANTHROPIC_API_KEY: "sk-ant-scenario-placeholder-long",
      DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      // This text-only verification never opens an audio session.
      DONGHAENG_STT_PROVIDER: "openai-compatible",
      DONGHAENG_STT_ENDPOINT: "https://stt.invalid/v1/audio/transcriptions",
      DONGHAENG_STT_API_KEY: "unused-scenario-verification",
      DONGHAENG_MODELING_PYTHON: pythonPath,
      DONGHAENG_MODELING_BASE_CASE: `data/mock/${scenario.primary.modelingCaseId}`,
    };

    await initializeLocalWorkspace(environment);
    await startServer(environment, origin);

    const login = await apiRequest(origin, "/api/auth/session", {
      method: "POST",
      mutationOrigin: origin,
      body: { email: "local@donghaeng.workspace", password: localWorkspacePassword },
    });
    expectSuccess(login, 201, "로그인");
    cookie = login.response.headers.get("set-cookie").split(";", 1)[0];
  }

  process.stdout.write("\n대본대로 인터뷰 진행\n");
  const primary = await runInterview(origin, cookie, scenario.primary, "본 인터뷰");
  check(
    "영업일 사유 질문이 인터뷰에 나옴",
    primary.askedInfoCodes.includes("operating_day_drop_reason"),
    `질문 ${primary.askedInfoCodes.length}개`,
  );
  check(
    "12항목이 전부 정리됨",
    primary.live.canonicalInformationItems.length === 12,
    `${primary.live.canonicalInformationItems.length}개`,
  );
  check(
    "FINAL 완료 상태",
    primary.completed.snapshot.completionStatus === "COMPLETE",
    primary.completed.snapshot.completionStatus,
  );
  check(
    "평가가 만들어짐",
    primary.completed.evaluation?.status === "READY",
    primary.completed.evaluation?.status ?? "없음",
  );
  const goal = primary.completed.snapshot.goalSnapshot;
  check(
    "영업일 목표가 29일로 확정됨",
    goal?.target?.value?.value === 29 && goal?.target?.unit === "DAY",
    `${goal?.target?.value?.value ?? "없음"} ${goal?.target?.unit ?? ""}`,
  );

  process.stdout.write("\n대조 인터뷰 진행\n");
  const control = await runInterview(origin, cookie, scenario.control, "대조 인터뷰");
  check(
    "대조 인터뷰도 끝까지 진행됨",
    control.completed.snapshot.completionStatus === "COMPLETE",
    control.completed.snapshot.completionStatus,
  );

  process.stdout.write("\n2축 점수 대조\n");
  const primaryCard = await readScorecard(origin, cookie, primary.completed.evaluation.id, "본");
  const controlCard = await readScorecard(origin, cookie, control.completed.evaluation.id, "대조");
  check("본 인터뷰 점수가 계산됨", primaryCard.status === "READY", primaryCard.unavailableMessage ?? "");
  check("대조 인터뷰 점수가 계산됨", controlCard.status === "READY", controlCard.unavailableMessage ?? "");

  const primaryScores = axisScores(primaryCard.scorecard);
  const controlScores = axisScores(controlCard.scorecard);
  const expectedPrimary = await mockScores(pythonPath, scenario.primary.modelingCaseId);
  const expectedControl = await mockScores(pythonPath, scenario.control.modelingCaseId);

  check(
    "본 인터뷰가 mock 케이스와 같은 점수",
    primaryScores.current === expectedPrimary.current
      && primaryScores.improvement === expectedPrimary.improvement,
    `현재 ${primaryScores.current} / 개선 ${primaryScores.improvement}`,
  );
  check(
    "대조 인터뷰가 mock 케이스와 같은 점수",
    controlScores.current === expectedControl.current
      && controlScores.improvement === expectedControl.improvement,
    `현재 ${controlScores.current} / 개선 ${controlScores.improvement}`,
  );
  check(
    "거래 데이터가 같아 현재 상황 점수는 같음",
    primaryScores.current === controlScores.current,
    `${primaryScores.current} = ${controlScores.current}`,
  );
  check(
    "사유와 목표를 답한 쪽의 개선가능성이 더 높음",
    primaryScores.improvement > controlScores.improvement,
    `${primaryScores.improvement} > ${controlScores.improvement}`,
  );

  process.stdout.write("\n재현성\n");
  const repeated = await readScorecard(origin, cookie, primary.completed.evaluation.id, "재실행");
  check(
    "같은 인터뷰를 두 번 계산해도 결과가 같음",
    JSON.stringify(repeated.scorecard) === JSON.stringify(primaryCard.scorecard),
  );

  process.stdout.write("\n6개월 뒤 재평가\n");
  const reevaluation = JSON.parse(
    await runProcess(pythonPath, ["-m", "modeling.reevaluate", "--json"]),
  );
  check(
    "목표 영업일을 같은 계산 함수로 다시 잰다",
    reevaluation.goal_feature === "biz_operating_day_count_avg_3m",
    `${reevaluation.before} → ${reevaluation.after} (목표 ${reevaluation.target})`,
  );
  check("목표 달성 여부가 나온다", reevaluation.reached === true, String(reevaluation.reached));

  const failed = checks.filter((item) => !item.passed);
  process.stdout.write(`\n검사 ${checks.length}개 중 ${checks.length - failed.length}개 통과\n`);
  if (failed.length > 0) {
    process.stdout.write(`실패: ${failed.map((item) => item.name).join(", ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("전체 통과\n");
}

try {
  await main();
} catch (error) {
  process.stdout.write(`\n중단: ${error.message}\n`);
  if (serverLog) process.stdout.write(`\n서버 로그:\n${serverLog}\n`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (providerStub) await new Promise((done) => providerStub.close(done));
  if (temporaryDirectory && dirname(resolve(temporaryDirectory)) === join(projectRoot, "data") && basename(temporaryDirectory).startsWith("verify-")) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
