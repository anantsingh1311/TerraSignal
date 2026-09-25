<#
.SYNOPSIS
  Resets the local PostgreSQL password when it has been lost, then restores
  password authentication.

.DESCRIPTION
  A default Windows PostgreSQL install requires a password for every local
  connection, so there is no way in once the password is lost. This script
  briefly switches local connections to "trust", sets a new password, and then
  puts "scram-sha-256" back.

  The window where the database accepts local connections without a credential
  is a few seconds. The revert runs in a finally block so it still happens if
  the password change fails.

  Run this from an ELEVATED PowerShell (Run as Administrator) - restarting the
  service requires it.

.EXAMPLE
  .\scripts\reset-postgres-password.ps1
#>

[CmdletBinding()]
param(
  [string]$PgVersion = "17",
  [string]$Role = "postgres",
  [string]$ServiceName = "postgresql-x64-17"
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "This script must run from an elevated PowerShell. Right-click PowerShell and choose 'Run as Administrator'."
}

$dataDir = "C:\Program Files\PostgreSQL\$PgVersion\data"
$binDir = "C:\Program Files\PostgreSQL\$PgVersion\bin"
$hbaPath = Join-Path $dataDir "pg_hba.conf"
$psqlPath = Join-Path $binDir "psql.exe"

foreach ($required in @($hbaPath, $psqlPath)) {
  if (-not (Test-Path $required)) { throw "Not found: $required  (is -PgVersion correct?)" }
}

$newPassword = Read-Host "New password for role '$Role'" -AsSecureString
$confirm = Read-Host "Confirm" -AsSecureString

$toPlain = {
  param($secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$plain = & $toPlain $newPassword
$plainConfirm = & $toPlain $confirm

if ($plain -ne $plainConfirm) { throw "Passwords did not match. Nothing was changed." }
if ([string]::IsNullOrWhiteSpace($plain)) { throw "Password cannot be empty. Nothing was changed." }
if ($plain -match "'") { throw "Avoid single quotes in the password; they break the SQL literal below." }

# Timestamped backup so the original file is always recoverable.
$backup = "$hbaPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $hbaPath $backup
Write-Host "Backed up pg_hba.conf to $backup" -ForegroundColor DarkGray

$original = Get-Content $hbaPath -Raw

try {
  # Trust only loopback host lines. The 'local' lines are left alone: on
  # Windows they are unused, and narrowing the change narrows the exposure.
  $trusted = [regex]::Replace(
    $original,
    '(?m)^(host\s+\S+\s+\S+\s+(?:127\.0\.0\.1/32|::1/128)\s+)\S+\s*$',
    '${1}trust'
  )

  if ($trusted -eq $original) {
    throw "Could not find loopback host rules to modify in $hbaPath. Nothing was changed."
  }

  Set-Content -Path $hbaPath -Value $trusted -Encoding ascii
  Write-Host "Loopback connections temporarily set to 'trust'." -ForegroundColor Yellow

  Restart-Service $ServiceName -Force
  Start-Sleep -Seconds 3

  $escaped = $plain.Replace("'", "''")
  & $psqlPath -U $Role -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 `
    -c "ALTER USER `"$Role`" WITH PASSWORD '$escaped';" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "psql failed to set the password (exit $LASTEXITCODE)." }

  Write-Host "Password updated for role '$Role'." -ForegroundColor Green
}
finally {
  # Always restore password authentication, even if the steps above failed.
  Set-Content -Path $hbaPath -Value $original -Encoding ascii
  try {
    Restart-Service $ServiceName -Force
    Start-Sleep -Seconds 3
    Write-Host "Password authentication restored (scram-sha-256)." -ForegroundColor Green
  }
  catch {
    Write-Warning "Could not restart $ServiceName. pg_hba.conf has been restored on disk; restart the service manually before using the database."
  }
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Put the new password in .env as:  PGPASSWORD=<the password you just set>"
Write-Host "  2. Verify with:  npm run db:check"
Write-Host "  3. Start the API with:  npm run api"
