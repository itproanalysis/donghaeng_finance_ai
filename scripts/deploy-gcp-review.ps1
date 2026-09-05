param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [string]$Region = 'asia-northeast3',
  [string]$ServiceName = 'donghaeng-finance-ai'
)
$ErrorActionPreference = 'Stop'
if ($ProjectId -eq 'abis-web-platform' -and $ServiceName -eq 'donghaeng-finance-ai') {
  throw 'This is the live authenticated service. The retired synthetic-review deployer must not overwrite it. See docs/GCP_LIVE_SERVICE.md.'
}
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoPath
try {
  $billingJson = & gcloud billing projects describe $ProjectId --format=json
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect project billing.' }
  $billingState = $billingJson | ConvertFrom-Json
  if (-not $billingState.billingEnabled) { throw 'Cloud Run deployment requires billing to be linked to the chosen project. This script never modifies billing.' }
  & npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
  & npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }
  & npm test -- --reporter=dot
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
  & gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$ProjectId --quiet
  if ($LASTEXITCODE -ne 0) { throw 'API enablement failed.' }
  & gcloud run deploy $ServiceName --source=. --project=$ProjectId --region=$Region --platform=managed --port=8080 --cpu=1 --memory=1Gi --min-instances=0 --max-instances=2 --concurrency=40 --timeout=60 --allow-unauthenticated --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deployment failed.' }
  $serviceUrl = & gcloud run services describe $ServiceName --project=$ProjectId --region=$Region '--format=value(status.url)'
  if ($LASTEXITCODE -ne 0 -or -not $serviceUrl) { throw 'Unable to resolve deployed URL.' }
  $health = Invoke-RestMethod -Uri "$serviceUrl/healthz"
  if ($health.mode -ne 'synthetic-review') { throw 'Deployed health check failed.' }
  foreach ($route in @('/', '/demo/borrower', '/demo/admin')) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$serviceUrl$route"
    if ($response.StatusCode -ne 200) { throw "Public page failed: $route" }
  }
  try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "$serviceUrl/api/interviews"
    throw 'Real interview API must not be publicly available.'
  } catch {
    if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
  }
  Write-Output "Public synthetic review deployed: $serviceUrl"
} finally { Pop-Location }
