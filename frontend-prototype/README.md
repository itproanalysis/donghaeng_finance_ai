# 동행금융 퀘스트 프런트엔드 프로토타입

개인사업자가 골목을 걸으며 세 가지 회복 퀘스트에 답하고, 수집한 근거를 바탕으로 본 AI 인터뷰에 진입하는 인터랙티브 프런트엔드입니다.

## 사용자 흐름

1. 골목을 따라 이동하며 퀘스트 지점을 발견합니다.
2. 매출 변화 원인, 조정 가능한 지출, 준비 가능한 증빙에 답합니다.
3. 답변마다 회복 근거를 하나씩 획득합니다.
4. 세 근거를 모두 모으면 밝아진 카페에서 `/demo` AI 인터뷰로 이어집니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
cd frontend-prototype
npm ci
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

## Vercel 배포

Vercel 프로젝트의 Root Directory를 `frontend-prototype`으로 지정하고 Production Branch를 `main`으로 설정합니다. 저장소에 포함된 `vercel.json`이 `npm ci`와 `npm run build:vercel`을 적용하며, Nitro가 Vercel Build Output API 형식인 `.vercel/output`을 생성합니다. `package.json`의 Node.js 엔진 조건에 따라 Vercel Node.js 22 이상을 사용해야 합니다.

Typecast 음성을 사용하려면 Vercel 프로젝트 환경 변수에 `TYPECAST_API_KEY`를 등록합니다. 선택 기능인 네이버 지도 파노라마는 `NEXT_PUBLIC_NAVER_MAPS_NCP_KEY_ID`를 등록하지 않아도 fallback 화면으로 동작합니다.

## 검증

```bash
npm run build
node --test tests/rendered-html.test.mjs
```

이 디렉터리는 기존 서버 애플리케이션을 변경하지 않고 UX를 검토할 수 있도록 독립 실행형으로 추가했습니다. 실제 제품에 통합할 때는 `/demo` 진입을 루트 프로젝트의 `/borrower` 인터뷰 흐름과 연결하면 됩니다.
