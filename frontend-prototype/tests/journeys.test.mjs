import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptAnswer,
  completeCase,
  readCollection,
  proposalsFor,
  EMPTY_REVIEW,
  INTERVIEW_QUESTIONS,
  CHECK_DOCUMENTS,
} from "../app/lib/case-model.ts";
import {
  consultationText,
  preparationReady,
} from "../app/lib/consultation-report.ts";
import { exportInterview, importInterview } from "../app/lib/case-transfer.ts";
import {
  startCase,
  selectCase,
  recordQuest,
  getCurrentCase,
} from "../app/lib/case-store.ts";

const now = "2026-09-03T12:00:00.000Z";
function fresh() {
  return {
    id: "test-case",
    createdAt: now,
    updatedAt: now,
    businessName: "검증용 가게",
    borrowerName: "테스트 사장님",
    quests: ["상권 변화", "임대료", "매출 자료"],
    answers: [],
    completedAt: null,
    review: { ...EMPTY_REVIEW, documents: [] },
  };
}
function answered() {
  return INTERVIEW_QUESTIONS.reduce(
    (item, question, index) =>
      acceptAnswer(item, question.id, `확인한 답변 ${index + 1}`, now),
    fresh(),
  );
}

test("an edited answer preserves other accepted answers and the alley choices", () => {
  const original = answered();
  const edited = acceptAnswer(
    original,
    "change",
    "  휴업 후 재개업했습니다.  ",
    now,
  );
  assert.equal(edited.answers[0].answerText, "휴업 후 재개업했습니다.");
  assert.equal(edited.answers[0].revision, 2);
  assert.deepEqual(edited.answers.slice(1), original.answers.slice(1));
  assert.deepEqual(edited.quests, original.quests);
  assert.equal(original.answers[0].answerText, "확인한 답변 1");
});

test("completion requires the business and all answers, then freezes the source", () => {
  assert.throws(() => completeCase(fresh(), now));
  assert.throws(() => completeCase({ ...answered(), businessName: " " }, now));
  const completed = completeCase(answered(), now);
  assert.equal(completed.completedAt, now);
  assert.throws(() => acceptAnswer(completed, "change", "바꾸기", now));
  assert.equal(completeCase(completed, "later"), completed);
});

test("empty, unknown, or oversized replies cannot advance the interview", () => {
  for (const [id, reply] of [
    ["change", " "],
    ["unknown", "답변"],
    ["change", "가".repeat(3001)],
  ]) {
    assert.throws(() => acceptAnswer(fresh(), id, reply, now));
  }
});

test("stored cases survive a reload and malformed source records are rejected", () => {
  const item = completeCase(answered(), now);
  const collection = { version: 1, currentId: item.id, cases: [item] };
  assert.deepEqual(readCollection(JSON.stringify(collection)), collection);
  assert.equal(readCollection("{broken").cases.length, 0);
  const forged = structuredClone(collection);
  forged.cases[0].answers[0].questionText = "알 수 없는 질문";
  assert.equal(readCollection(JSON.stringify(forged)).cases.length, 0);
  const duplicate = structuredClone(collection);
  duplicate.cases[0].answers[1] = duplicate.cases[0].answers[0];
  assert.equal(readCollection(JSON.stringify(duplicate)).cases.length, 0);
});

test("improvement proposals cite the current answers and do not invent expense evidence", () => {
  const item = answered();
  assert.equal(proposalsFor(item)[0].reason, item.answers[0].answerText);
  assert.match(proposalsFor(item)[1].reason, /임대료/);
  const noAlley = { ...item, quests: [null, null, null] };
  assert.equal(proposalsFor(noAlley)[1].source, "추가 확인 제안");
  assert.equal(proposalsFor(noAlley)[2].reason, item.answers[2].answerText);
});

test("financial handoff requires review, all preparation items, and an institution", () => {
  const completed = completeCase(answered(), now);
  assert.equal(preparationReady(completed), false);
  assert.throws(() => consultationText(completed));
  const prepared = {
    ...completed,
    review: {
      ...completed.review,
      proposalId: "evidence",
      dueDate: "2026-09-10",
      reviewed: true,
      documents: [...CHECK_DOCUMENTS],
    },
  };
  assert.equal(preparationReady(prepared), true);
  assert.throws(() => consultationText(prepared));
  const selected = {
    ...prepared,
    review: { ...prepared.review, institution: "semas" },
  };
  const report = consultationText(selected);
  for (const answer of selected.answers) {
    assert.ok(report.includes(answer.questionText));
    assert.ok(report.includes(answer.answerText));
  }
  assert.match(report, /기관 미전송/);
  assert.match(report, /검증용 가게/);
  assert.match(report, /소상공인시장진흥공단/);
  assert.throws(() =>
    consultationText({
      ...selected,
      review: { ...selected.review, reviewed: false },
    }),
  );
  assert.throws(() =>
    consultationText({
      ...selected,
      review: { ...selected.review, documents: CHECK_DOCUMENTS.slice(1) },
    }),
  );
});

test("portable interviews preserve accepted evidence without importing another reviewer's decisions", () => {
  const completed = completeCase(answered(), now);
  const reviewed = {
    ...completed,
    review: { ...completed.review, reviewed: true, proposalId: "evidence" },
  };
  const imported = importInterview(exportInterview(reviewed));
  assert.deepEqual(imported.answers, completed.answers);
  assert.deepEqual(imported.quests, completed.quests);
  assert.deepEqual(imported.review, EMPTY_REVIEW);
  assert.throws(() => exportInterview(fresh()));
  assert.throws(() => importInterview("{}"));
  assert.throws(() => importInterview(" ".repeat(64001)));
});

test("selecting a case in another tab cannot redirect the current interview's next answer", () => {
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  };
  const tabA = storage();
  const tabB = storage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: tabA,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true,
  });
  try {
    const a = startCase();
    Object.defineProperty(globalThis, "sessionStorage", {
      value: tabB,
      configurable: true,
    });
    const b = startCase();
    selectCase(b.id);
    Object.defineProperty(globalThis, "sessionStorage", {
      value: tabA,
      configurable: true,
    });
    assert.equal(getCurrentCase().id, a.id);
    recordQuest(0, "첫 번째 사장님의 변화");
    assert.equal(getCurrentCase().quests[0], "첫 번째 사장님의 변화");
    Object.defineProperty(globalThis, "sessionStorage", {
      value: tabB,
      configurable: true,
    });
    assert.equal(getCurrentCase().id, b.id);
    assert.equal(getCurrentCase().quests[0], null);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.window;
  }
});
