[CmdletBinding()]
param(
    [string]$RepositoryRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-PlainText {
    param([Security.SecureString]$SecureValue)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Protect-LocalSecretAcl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [bool]$Container
    )

    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
    $administrators = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    $security = if ($Container) {
        [Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        [Security.AccessControl.FileSecurity]::new()
    }
    $security.SetOwner($currentUser)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = if ($Container) {
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
        [Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($identity in @($currentUser, $system, $administrators)) {
        $security.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $identity,
                [Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow
            )
        )
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

try {
    if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
        $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    }
    $RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot "package.json") -PathType Leaf)) {
        throw "동행금융AI 저장소를 확인하지 못했습니다: $RepositoryRoot"
    }

    Write-Host ""
    Write-Host "[동행금융AI] Claude API 키 로컬 보안 설정" -ForegroundColor Cyan
    Write-Host "키는 화면에 표시되지 않으며 Git/.env에 기록하지 않습니다."
    Write-Host "Windows DPAPI로 현재 Windows 사용자만 복호화할 수 있게 저장합니다."
    Write-Host "채팅이나 문서에 노출된 키는 운영 배포 전에 반드시 회전하세요." -ForegroundColor Yellow
    Write-Host ""

    $secureKey = Read-Host "Anthropic API 키를 붙여넣고 Enter" -AsSecureString
    $plainKey = Get-PlainText -SecureValue $secureKey
    try {
        if (
            [string]::IsNullOrWhiteSpace($plainKey) -or
            -not $plainKey.StartsWith("sk-ant-", [StringComparison]::Ordinal) -or
            $plainKey.Length -lt 40 -or
            $plainKey.Length -gt 512 -or
            $plainKey -match "\s"
        ) {
            throw "Anthropic API 키 형식이 올바르지 않습니다. 값은 저장하지 않았습니다."
        }

        $secretDirectory = Join-Path $RepositoryRoot "data\secrets"
        $secretPath = Join-Path $secretDirectory "anthropic-api-key.dpapi"
        New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
        Protect-LocalSecretAcl -Path $secretDirectory -Container $true
        $ciphertext = ConvertFrom-SecureString -SecureString $secureKey
        $temporaryPath = "$secretPath.$([Guid]::NewGuid().ToString('N')).tmp"
        [IO.File]::WriteAllText($temporaryPath, $ciphertext, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $secretPath -Force
        Protect-LocalSecretAcl -Path $secretPath -Container $false
        Write-Host "[완료] Claude 키를 Windows 사용자 범위로 암호화해 저장했습니다." -ForegroundColor Green
        Write-Host "       $secretPath"
    }
    finally {
        $plainKey = $null
    }
}
catch {
    Write-Host "[실패] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
