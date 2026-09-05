# GCP 동행금융 실제 서비스

기준일: 2026-09-04. 공개 데모가 아닌 **본인 Google 계정 전용 실제 서비스**다. 다기관·다수 고객용 운영 승인이나 금융기관 접수를 뜻하지 않는다.

- 주소: https://donghaeng-finance-ai-jy5k5cvnjq-du.a.run.app/
- 프로젝트: `abis-web-platform` (`470320899177`), 서울 `asia-northeast3`
- 허용 사용자: `itproanalysis@gmail.com`; IAP와 앱의 서명 검증/메일 allowlist 모두 적용
- 역할: 현재 허용 계정에 `ADMIN`, `INTERVIEWER`; 기관/사장님별 계정 발급은 아직 별도 설계 대상
- 데이터: 새 GCP DB. 로컬 인터뷰·음성·데모 데이터는 업로드하지 않았다.

## 구성

```text
Google 로그인 → Cloud Run donghaeng-finance-ai (HTTPS + IAP)
               → 전용 VPC → donghaeng-app VM:3000 (custom Next server)
                           ├─ donghaeng-data 별도 영구 디스크 /data
                           ├─ Secret Manager → 런타임 메모리
                           └─ 실제 Anthropic/OpenAI API
```

- Cloud Run은 HTTPS 프록시다. HTTP/SSE/음성 WebSocket을 전달하고 WebRTC는 브라우저가 OpenAI와 연결한다.
- VM `donghaeng-app`, zone `asia-northeast3-a`, `e2-small`, 내부 IP `10.80.0.10`.
- 별도 `donghaeng-network` / `donghaeng-seoul` VPC. 3000번은 gateway 네트워크 태그만 허용; SSH는 IAP TCP 경로만 허용한다. VM 외부 IP는 AI API 및 패키지 다운로드의 송신용이며 공개 HTTP/SSH 인바운드 규칙은 없다.
- SQLite는 별도 `donghaeng-data` 10GB 디스크에 저장한다. VM 삭제 시 디스크 자동 삭제를 끄고 VM 삭제 보호를 켰다. 컨테이너는 재기동 시 같은 디스크를 마운트한다.
- 정적 질문 캐시와 실제 DB 디렉터리를 분리한다. 동적 개인화 음성은 디스크에 저장하지 않으며 HTTP 응답은 `no-store`다.
- 런타임 전용 서비스 계정은 동행금융 저장소 읽기와 두 개의 지정 Secret 읽기 권한만 가진다. 공급자 키를 이미지/소스/로그/메타데이터/평문 파일에 넣지 않는다.
- `deploy/start-gcp-vm.sh`는 정확한 VM·프로젝트·새 데이터 디스크를 검증한다. 서명이 있는 디스크는 포맷하지 않는다. systemd는 마운트된 디스크를 요구하고 프로세스 실패 시 재기동한다.

## 모델과 실제 호출 검증

| 경로 | 운영 설정 | 서버 측 확인 |
|---|---|---|
| 텍스트 인터뷰 | `claude-sonnet-5` | 실제 Messages 응답 200 |
| 주 음성 | `gpt-realtime-2.1`, `marin`, WebRTC | 세션 발급 200; 별도 합성 입력 WebSocket 음성 입출력 성공 |
| 보조 STT | `gpt-transcribe` | 생성한 한국어 문장을 실제 전사, 200 |
| 보조 TTS | `gpt-4o-mini-tts`, `marin` | WAV 생성 200, 158,444 bytes |

합성 점검 문장만 사용했다. Realtime 음성 출력 254,400 bytes, 입력 commit부터 첫 출력 음성까지 단일 측정 1,370ms. 실사용 지연 SLO/인간 청취 품질/브라우저 WebRTC 측정이 아니다. 공급자 재검증 스크립트는 `scripts/check-gcp-providers.mjs`; 전용 컨테이너 안에서 실행하고 자격증명·응답 내용은 출력하지 않는다. 실행 시 소량의 공급자 비용이 발생한다.

## 빌드와 재배포

운영 이미지는 **Dockerfile.gcp** 및 `deploy/cloudbuild.gcp.yaml`을 사용한다. 과거 `Dockerfile`/`review-server.mjs`/`deploy-gcp-review.ps1`는 실제 기능을 막는 옛 체험용이므로 이 서비스에 사용하지 않는다.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
gcloud meta list-files-for-upload
gcloud builds submit . --config=deploy/cloudbuild.gcp.yaml --project=abis-web-platform --async
```

빌드 `SUCCESS`와 이미지 digest를 확인한 뒤 VM의 `donghaeng-image` 메타데이터를 해당 Build ID 태그로 바꾸고 `sudo google_metadata_script_runner startup`을 실행한다. 스크립트는 새 이미지 pull에 성공한 뒤에만 서비스를 재시작한다. 이전 Build ID로 되돌려 동일하게 재시작하면 코드 롤백할 수 있다. DB 스키마를 과거로 자동 되돌리지는 않는다.

게이트웨이 수정은 `deploy/gateway` 디렉터리만 빌드하고 Cloud Run의 `--image`만 갱신한다. 기존 IAP/OAuth 설정은 보존한다. 기본 서비스 URL 외 숫자형 Cloud Run URL은 기본 URL로 이동시켜 Origin 불일치를 막는다.

## 운영 확인과 복구

- DB 무결성 `PRAGMA quick_check=ok`, 초기 인터뷰 0건 확인.
- 2026-09-04 공모전 목적·상담 메모 개선 최종 배포 이미지: `ad0e3c67-ea6e-41c4-b70b-6ab7870553b7`, digest `sha256:d0010ae99bd2f98e05d2173781f03e2069080bc5d67ceb81d0874639aa41be35`. gateway revision `donghaeng-finance-ai-00004-d6p`. 컨테이너 이미지와 systemd active, 로그인된 실제 웹의 금융 상담 목적·3단계 흐름·제공 범위를 확인했다.
- 직전 화면 순회 버전: `db531967-d50a-4022-ae7d-e4dd0af7d1e5`, digest `sha256:5d613b18bc8411947d2763fb5a1a89f5a3345acc9d09f19b9883172bb0f398a6`. 기본 정보/관리자 목록 수정은 이 버전에서 먼저 운영 검증했다.
- 배포 전 디스크 스냅샷: `donghaeng-data-before-review-20260904`. 정기 백업·복원 리허설은 아직 운영 승인 전 미완료다.
- 앱 프로세스 상태: `systemctl status donghaeng`, 로그: `docker logs --tail 30 donghaeng-app`. 로그에 전사·키·JWT를 출력하지 않는다.
- 비로그인 웹 요청은 Google 로그인으로 리다이렉트. backend 직접 요청은 서명된 IAP assertion 없이는 페이지/API 모두 거절한다.
- IAP audience는 `/projects/470320899177/locations/asia-northeast3/services/donghaeng-finance-ai`다. 단순 이메일 헤더·로컬 cookie는 대체 인증으로 인정하지 않는다.
- 로그인 페이지를 다시 방문해도 불가능한 비밀번호 폼을 표시하지 않고 안전한 내부 경로로 이동한다.
- `allUsers` 호출 권한을 추가하거나 IAP를 끄지 않는다. 다른 계정을 허용하려면 IAP 접근 정책과 앱 allowlist/역할 정책을 함께 검토해야 한다.

## 남은 경계

단일 VM/단일 zone SQLite이므로 고가용성·수평 확장 구성은 아니다. 실제 고객 운영 전에는 정기 백업/복원, 장애 알림, 부하·30분 음성·장치별 WebRTC/마이크/스피커 점검, 보존·동의·기관별 권한·개인정보/모델 거버넌스 검토가 필요하다. `PRODUCTION_GATES.md`를 이 한 계정용 배포로 모두 통과한 것으로 보지 않는다.

설계 근거: [Cloud Run IAP](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run), [IAP 서명 검증](https://docs.cloud.google.com/iap/docs/signed-headers-howto), [OpenAI 음성 생성](https://developers.openai.com/api/docs/guides/text-to-speech).
