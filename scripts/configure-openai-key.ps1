[CmdletBinding()]
param(
    [string]$RepositoryRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-OpenAIKeyFromDialog {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    [Windows.Forms.Application]::EnableVisualStyles()
    $form = [Windows.Forms.Form]::new()
    $form.Text = "동행금융AI · OpenAI Realtime 키 설정"
    $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ShowInTaskbar = $true
    $form.TopMost = $true
    $form.ClientSize = [Drawing.Size]::new(560, 230)
    $form.Font = [Drawing.Font]::new("Malgun Gothic", 10)

    $title = [Windows.Forms.Label]::new()
    $title.Text = "OpenAI Realtime API 키를 입력해 주세요"
    $title.Font = [Drawing.Font]::new("Malgun Gothic", 14, [Drawing.FontStyle]::Bold)
    $title.AutoSize = $true
    $title.Location = [Drawing.Point]::new(24, 22)

    $description = [Windows.Forms.Label]::new()
    $description.Text = "입력값은 화면에 표시되지 않으며 Windows DPAPI로 암호화됩니다.`r`n소스·Git·.env에는 저장하지 않습니다."
    $description.AutoSize = $true
    $description.ForeColor = [Drawing.Color]::FromArgb(70, 83, 105)
    $description.Location = [Drawing.Point]::new(26, 61)

    $keyBox = [Windows.Forms.TextBox]::new()
    $keyBox.Location = [Drawing.Point]::new(28, 112)
    $keyBox.Size = [Drawing.Size]::new(504, 28)
    $keyBox.UseSystemPasswordChar = $true
    $keyBox.ShortcutsEnabled = $true
    $keyBox.TabIndex = 0

    $saveButton = [Windows.Forms.Button]::new()
    $saveButton.Text = "암호화해 저장"
    $saveButton.Location = [Drawing.Point]::new(370, 168)
    $saveButton.Size = [Drawing.Size]::new(162, 38)
    $saveButton.DialogResult = [Windows.Forms.DialogResult]::OK
    $saveButton.TabIndex = 1

    $cancelButton = [Windows.Forms.Button]::new()
    $cancelButton.Text = "취소"
    $cancelButton.Location = [Drawing.Point]::new(270, 168)
    $cancelButton.Size = [Drawing.Size]::new(88, 38)
    $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $cancelButton.TabIndex = 2

    $form.Controls.AddRange(@($title, $description, $keyBox, $saveButton, $cancelButton))
    $form.AcceptButton = $saveButton
    $form.CancelButton = $cancelButton
    $form.Add_Shown({ $keyBox.Focus() })
    try {
        $result = $form.ShowDialog()
        if ($result -ne [Windows.Forms.DialogResult]::OK) {
            return $null
        }
        return $keyBox.Text
    }
    finally {
        $keyBox.Clear()
        $form.Dispose()
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
    # Windows PowerShell can fail to auto-load Microsoft.PowerShell.Security in
    # restricted desktop hosts. Call the .NET ACL extension directly so secure
    # key setup does not depend on the Set-Acl cmdlet/module loader.
    if ($Container) {
        [IO.FileSystemAclExtensions]::SetAccessControl(
            [IO.DirectoryInfo]::new($Path),
            [Security.AccessControl.DirectorySecurity]$security
        )
    }
    else {
        [IO.FileSystemAclExtensions]::SetAccessControl(
            [IO.FileInfo]::new($Path),
            [Security.AccessControl.FileSecurity]$security
        )
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
        $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    }
    $RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot "package.json") -PathType Leaf)) {
        throw "동행금융AI 저장소를 확인하지 못했습니다: $RepositoryRoot"
    }

    $plainKey = Read-OpenAIKeyFromDialog
    try {
        if ($null -eq $plainKey) {
            throw "OpenAI 키 설정을 취소했습니다."
        }
        if (
            [string]::IsNullOrWhiteSpace($plainKey) -or
            -not $plainKey.StartsWith("sk-", [StringComparison]::Ordinal) -or
            $plainKey.Length -lt 20 -or
            $plainKey.Length -gt 2048 -or
            $plainKey -match "\s"
        ) {
            throw "OpenAI API 키 형식이 올바르지 않습니다. 값은 저장하지 않았습니다."
        }

        $secretDirectory = Join-Path $RepositoryRoot "data\secrets"
        $secretPath = Join-Path $secretDirectory "openai-api-key.dpapi"
        New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
        Protect-LocalSecretAcl -Path $secretDirectory -Container $true
        $secureKey = ConvertTo-SecureString -String $plainKey -AsPlainText -Force
        $ciphertext = ConvertFrom-SecureString -SecureString $secureKey
        $temporaryPath = "$secretPath.$([Guid]::NewGuid().ToString('N')).tmp"
        [IO.File]::WriteAllText($temporaryPath, $ciphertext, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryPath -Destination $secretPath -Force
        Protect-LocalSecretAcl -Path $secretPath -Container $false
        [Windows.Forms.MessageBox]::Show(
            "OpenAI 키를 안전하게 저장했습니다.`r`n이제 동행금융AI를 재기동하면 Realtime 음성이 활성화됩니다.",
            "동행금융AI · 저장 완료",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    finally {
        $plainKey = $null
    }
}
catch {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "동행금융AI · 저장 실패",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    catch {
        Write-Host "[실패] $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 1
}
