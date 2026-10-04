<#
.SYNOPSIS
  Temporary Linkwa SANDBOX credential session for local BidBlitz development.

.DESCRIPTION
  Prompts for the three Linkwa sandbox values, validates them, and sets them
  as PROCESS-ONLY environment variables ($env:LINKWA_API_KEY,
  $env:LINKWA_BASE_URL, $env:LINKWA_WEBHOOK_SECRET) in this PowerShell
  session. It then launches OpenCode from this same process so OpenCode and
  every child process (dev server, tests, scripts) inherit the variables.

  What this script NEVER does:
    - print, echo, or log the API key or webhook secret (only presence is
      ever reported, never contents);
    - write any secret to disk (.env, .env.local, source files, logs);
    - touch Vercel, GitHub, Supabase, DNS, or production configuration;
    - accept a production origin (it validates sandbox use before proceeding).

  The variables die with this PowerShell process (or `exit`). Nothing
  persists. This script itself contains no secrets and is safe to commit.

.EXAMPLE
  PS> .\scripts\start-linkwa-sandbox.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Read-SecretValue([string]$prompt) {
    $secure = Read-Host $prompt -AsSecureString
    if ($null -eq $secure) { return "" }
    # Convert only in memory, for validation and env assignment. The
    # plaintext is never written anywhere by this script.
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Test-HttpsOrigin([string]$value, [ref]$uriOut) {
    $uriOut.Value = $null
    if ([string]::IsNullOrWhiteSpace($value)) { return $false }
    $candidate = $value.Trim()
    $parsed = $null
    if (-not [Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$parsed)) { return $false }
    if ($parsed.Scheme -ne "https") { return $false }
    # Origin only: no path, query, fragment, userinfo, or non-default port.
    if ($parsed.AbsolutePath -ne "/") { return $false }
    if ($parsed.Query -ne "" -or $parsed.Fragment -ne "") { return $false }
    if ($parsed.UserInfo -ne "") { return $false }
    if (-not $parsed.IsDefaultPort) { return $false }
    $uriOut.Value = ($parsed.Scheme + "://" + $parsed.Host).ToLowerInvariant()
    return $true
}

Write-Host ""
Write-Host "Linkwa SANDBOX credential session (process-only, nothing is saved)." -ForegroundColor Cyan
Write-Host "Values are masked on entry and never printed back." -ForegroundColor DarkGray
Write-Host ""

$apiKey = Read-SecretValue -prompt "LINKWA_API_KEY (sandbox key)"
if ([string]::IsNullOrEmpty($apiKey)) {
    Write-Host "LINKWA_API_KEY is empty. Aborting; nothing was set." -ForegroundColor Red
    exit 1
}

$baseInput = (Read-Host "LINKWA_BASE_URL (sandbox https origin)").Trim()
$origin = $null
if (-not (Test-HttpsOrigin $baseInput ([ref]$origin))) {
    Write-Host "LINKWA_BASE_URL must be a valid https origin with no path, query, or port (example shape: https://sandbox-host.example)." -ForegroundColor Red
    Write-Host "Aborting; nothing was set." -ForegroundColor Red
    exit 1
}

# Sandbox guard: refuse anything that does not look like a sandbox/test
# origin. The base URL itself is not a secret, so it is safe to show back.
if ($origin -notmatch 'sandbox|test|staging|dev') {
    Write-Host ""
    Write-Host "WARNING: '$origin' does not look like a sandbox origin." -ForegroundColor Yellow
    Write-Host "This helper is sandbox-only and will not configure production." -ForegroundColor Yellow
    $answer = (Read-Host "Type SANDBOX to confirm this is nevertheless a sandbox origin, or anything else to abort").Trim()
    if ($answer -ne "SANDBOX") {
        Write-Host "Aborting; nothing was set." -ForegroundColor Red
        exit 1
    }
}

$webhookSecret = Read-SecretValue -prompt "LINKWA_WEBHOOK_SECRET (sandbox secret)"
if ([string]::IsNullOrEmpty($webhookSecret)) {
    Write-Host "LINKWA_WEBHOOK_SECRET is empty. Aborting; nothing was set." -ForegroundColor Red
    exit 1
}

$env:LINKWA_API_KEY = $apiKey
$env:LINKWA_BASE_URL = $origin
$env:LINKWA_WEBHOOK_SECRET = $webhookSecret

# Drop plaintext locals; the values live only in the process environment now.
$apiKey = $null
$webhookSecret = $null
$baseInput = $null

Write-Host ""
Write-Host "Sandbox session ready (origin: $origin)." -ForegroundColor Green
Write-Host "LINKWA_API_KEY: configured"
Write-Host "LINKWA_BASE_URL: configured"
Write-Host "LINKWA_WEBHOOK_SECRET: configured"
Write-Host ""
Write-Host "These exist only in this PowerShell process. Closing it ends the session." -ForegroundColor DarkGray
Write-Host ""

# Hand control to OpenCode in this same process tree so it inherits the
# variables. Prefer the installed command; otherwise tell the user to launch
# OpenCode from THIS window (parent -> child inheritance is what matters).
$opencode = Get-Command opencode -ErrorAction SilentlyContinue
if ($opencode) {
    Write-Host "Launching OpenCode from this session..." -ForegroundColor Cyan
    & opencode @args
} else {
    Write-Host "Could not find an 'opencode' command on PATH." -ForegroundColor Yellow
    Write-Host "Launch OpenCode from THIS PowerShell window (not from Start menu or a shortcut)"
    Write-Host "so it inherits the three variables, then tell the agent to verify presence."
}
