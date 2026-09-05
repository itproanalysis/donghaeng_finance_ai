# external-data

앱에 주입할 **외부 맥락 데이터의 정형 산출물**만 두는 폴더입니다.
앱은 외부 API·크롤러를 두지 않으므로 이 파일들이 그 자리를 대신합니다.

**설명은 `docs/`에 있습니다. 이 README는 파일 목록입니다.**

| 파일 | 내용 | 문서 |
|---|---|---|
| `peer_benchmark.json` | 11업종 × 12필드 주입물 (`FeatureV2Input.external`) | [DATA_EXTERNAL_CONTEXT](../docs/DATA_EXTERNAL_CONTEXT.md) |
| `coverage_matrix.json` | 132칸 상태 대장 — 빈 칸의 사유 | [DATA_INDUSTRY_COVERAGE](../docs/DATA_INDUSTRY_COVERAGE.md) |
| `industry_mapping.json` | KSIC(10차) → `SohoIndustryCode` 대응표 | [DATA_INDUSTRY_COVERAGE](../docs/DATA_INDUSTRY_COVERAGE.md) |
| `credit_position.json` | CreDB 신용 포지션 분위수 (배선 미정) | [DATA_CREDIT_POSITION](../docs/DATA_CREDIT_POSITION.md) |
| `verify_peer_benchmark_contract.py` | 계약 대조기 | [DATA_EXTERNAL_CONTEXT](../docs/DATA_EXTERNAL_CONTEXT.md) |
| `credit_position_lookup.py` | 값 → 백분위 역조회 | [DATA_CREDIT_POSITION](../docs/DATA_CREDIT_POSITION.md) |

두 스크립트 모두 **표준 라이브러리만** 사용합니다. 설치할 것이 없습니다.

```bash
python3 external-data/verify_peer_benchmark_contract.py
python3 external-data/credit_position_lookup.py --demo
```

## 원자료는 여기 두지 않습니다

`.gitignore`가 `csv` · `xlsx` · `zip`과 원자료 폴더의 유입을 막습니다. 이유는 셋입니다.

- 신용정보원 CreDB 모의DB·SDB 표본은 금융데이터거래소 **계정 인증 후 받는 자료**라
  재배포 조건이 열려 있지 않습니다
- git은 대용량 파일 이력을 영구 보관하므로, 한 번 커밋하면 나중에 지워도 이력에 남습니다
- 앱은 원자료를 읽지 않습니다. 읽는 것은 이 폴더의 JSON뿐입니다

원자료와 빌더는 데이터 저장소(`daker_finance_hackathon`)에 있고,
취득 경로는 각 artifact의 `source` 블록에 기록돼 있습니다.

## 손으로 고치지 마세요

빌더가 중간산출물에서 값을 계산합니다. 재생성 방법은
[DATA_EXTERNAL_CONTEXT](../docs/DATA_EXTERNAL_CONTEXT.md)에 있습니다.

문의: 데이터 리서치 담당 (sohyun lee)
