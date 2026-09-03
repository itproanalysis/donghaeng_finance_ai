param([string]$ProjectId='abis-web-platform',[string]$Region='asia-northeast3',[string]$ServiceName='donghaeng-finance')
$ErrorActionPreference='Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
  $billingJson = & gcloud billing projects describe $ProjectId --format=json
  if ($LASTEXITCODE -ne 0) { throw '프로젝트 결제 상태를 확인하지 못했습니다.' }
  $billingState = $billingJson | ConvertFrom-Json
  if (-not $billingState.billingEnabled) { throw 'abis-web-platform의 결제 연결이 비활성 상태입니다. 결제를 활성화한 뒤 배포할 수 있습니다.' }
  & gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw 'GCP API 활성화 실패' }
  $runtimeAccount = "donghaeng-runtime@$ProjectId.iam.gserviceaccount.com"
  $runtimeAccounts = & gcloud iam service-accounts list --project=$ProjectId '--format=value(email)'
  if ($LASTEXITCODE -ne 0) { throw '런타임 계정 조회 실패' }
  if ($runtimeAccount -notin $runtimeAccounts) {
    & gcloud iam service-accounts create donghaeng-runtime --project=$ProjectId '--display-name=Donghaeng Finance Cloud Run runtime' --quiet
    if ($LASTEXITCODE -ne 0) { throw '전용 런타임 계정 생성 실패' }
  }
  & gcloud run deploy $ServiceName --source=. --project=$ProjectId --region=$Region --platform=managed --service-account=$runtimeAccount --port=8080 --cpu=1 --memory=512Mi --min-instances=0 --max-instances=2 --concurrency=40 --timeout=60 --allow-unauthenticated --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Cloud Run 배포 실패' }
  $serviceUrl = & gcloud run services describe $ServiceName --project=$ProjectId --region=$Region '--format=value(status.url)'
  if ($LASTEXITCODE -ne 0 -or -not $serviceUrl) { throw '배포 URL 확인 실패' }
  foreach ($path in @('/','/demo','/results','/admin','/guide','/api/health','/audio/yujin-q1.wav','/interviewer-yujin.png')) {
    $response=Invoke-WebRequest -UseBasicParsing -Uri "$serviceUrl$path"
    if($response.StatusCode -ne 200){throw "페이지 확인 실패: $path"}
  }
  Write-Output "동행금융 배포 완료: $serviceUrl"
} finally { Pop-Location }
