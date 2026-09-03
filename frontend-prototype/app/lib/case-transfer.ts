import {
  EMPTY_REVIEW,
  readCollection,
  type CompanionCase,
} from "./case-model.ts";

export function exportInterview(item: CompanionCase) {
  if (!item.completedAt)
    throw new Error("인터뷰를 완료한 뒤 전달할 수 있습니다.");
  return JSON.stringify(
    {
      format: "donghaeng-interview-v1",
      interview: { ...item, review: { ...EMPTY_REVIEW, documents: [] } },
    },
    null,
    2,
  );
}

export function importInterview(raw: string): CompanionCase {
  if (raw.length > 64000)
    throw new Error(
      "기록 파일이 너무 큽니다. 동행금융에서 내려받은 파일을 선택해 주세요.",
    );
  try {
    const data = JSON.parse(raw);
    if (data.format !== "donghaeng-interview-v1") throw new Error();
    const collection = readCollection(
      JSON.stringify({ version: 1, currentId: null, cases: [data.interview] }),
    );
    const item = collection.cases[0];
    if (!item?.completedAt || !item.businessName.trim()) throw new Error();
    return { ...item, review: { ...EMPTY_REVIEW, documents: [] } };
  } catch {
    throw new Error(
      "완료된 동행금융 인터뷰 파일이 아닙니다. 파일 내용을 확인해 주세요.",
    );
  }
}
