<#
.SYNOPSIS
  Temporary Linkwa SANDBOX credential session for local BidBlitz development.

.DESCRIPTION
  Prompts for the three Linkwa sandbox values, validates them, and sets them
  as PROCESS-ONLY environment variables ($env:LINKWA_API_KEY,
  $env:LINKWA_BASE_URL, $env:LINKWA_WEBHOOK_SECRET) in the CURRENT PowerShell
  process, then returns to the prompt. Launch OpenCode yourself afterwards
  from this same window so it inherits the variables.

  DOT-SOURCE THIS SCRIPT (do not run it as a child process), otherwise the
  variables die with the child and your shell learns nothing:

      . .\scripts\start-linkwa-sandbox.ps1

  What this script NEVER does:
    - print, echo, or log the API key or webhook secret (only presence is
      ever reported, never contents);
    - write any secret to disk (.env, .env.local, source files, logs);
    - touch Vercel, GitHub, Supabase, DNS, or production configuration;
    - accept a production origin (it validates sandbox use before proceeding);
    - launch anything automatically (you start OpenCode when ready).

  The variables die with this PowerShell process. Nothing persists. This
  script itself contains no secrets and is safe to commit.

.EXAMPLE
  PS> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  PS> . .\scripts\start-linkwa-sandbox.ps1
  # ...enter the three values at the prompts...
  PS> opencode run "Verify that LINKWA_API_KEY, LINKWA_BASE_URL, and LINKWA_WEBHOOK_SECRET are configured in the current process. Report presence only; never print their values."
#>

function Read-LinkwaSecretValue([string]$prompt) {
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

function Test-LinkwaHttpsOrigin([string]$value, [ref]$uriOut) {
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

try {
    Write-Host ""
    Write-Host "Linkwa SANDBOX credential session (process-only, nothing is saved)." -ForegroundColor Cyan
    Write-Host "Values are masked on entry and never printed back." -ForegroundColor DarkGray
    Write-Host ""

    $linkwaApiKey = Read-LinkwaSecretValue -prompt "LINKWA_API_KEY (sandbox key)"
    if ([string]::IsNullOrEmpty($linkwaApiKey)) {
        throw "LINKWA_API_KEY is empty. Aborting; nothing was set."
    }

    $linkwaBaseInput = (Read-Host "LINKWA_BASE_URL (sandbox https origin)").Trim()
    $linkwaOrigin = $null
    if (-not (Test-LinkwaHttpsOrigin $linkwaBaseInput ([ref]$linkwaOrigin))) {
        throw "LINKWA_BASE_URL must be a valid https origin with no path, query, or port (example shape: https://sandbox-host.example). Aborting; nothing was set."
    }

    # Sandbox guard: refuse anything that does not look like a sandbox/test
    # origin. The base URL itself is not a secret, so it is safe to show back.
    if ($linkwaOrigin -notmatch 'sandbox|test|staging|dev') {
        Write-Host ""
        Write-Host "WARNING: '$linkwaOrigin' does not look like a sandbox origin." -ForegroundColor Yellow
        Write-Host "This helper is sandbox-only and will not configure production." -ForegroundColor Yellow
        $linkwaAnswer = (Read-Host "Type SANDBOX to confirm this is nevertheless a sandbox origin, or anything else to abort").Trim()
        if ($linkwaAnswer -ne "SANDBOX") {
            throw "Aborting; nothing was set."
        }
    }

    $linkwaWebhookSecret = Read-LinkwaSecretValue -prompt "LINKWA_WEBHOOK_SECRET (sandbox secret)"
    if ([string]::IsNullOrEmpty($linkwaWebhookSecret)) {
        throw "LINKWA_WEBHOOK_SECRET is empty. Aborting; nothing was set."
    }

    $env:LINKWA_API_KEY = $linkwaApiKey
    $env:LINKWA_BASE_URL = $linkwaOrigin
    $env:LINKWA_WEBHOOK_SECRET = $linkwaWebhookSecret

    Write-Host ""
    Write-Host "Sandbox session ready (origin: $linkwaOrigin)." -ForegroundColor Green
    Write-Host "LINKWA_API_KEY: configured"
    Write-Host "LINKWA_BASE_URL: configured"
    Write-Host "LINKWA_WEBHOOK_SECRET: configured"
    Write-Host ""
    Write-Host "These exist only in this PowerShell process. Closing it ends the session." -ForegroundColor DarkGray
    Write-Host "Start OpenCode from THIS window when ready, e.g.:"
    Write-Host '  opencode run "Verify that LINKWA_API_KEY, LINKWA_BASE_URL, and LINKWA_WEBHOOK_SECRET are configured in the current process. Report presence only; never print their values."'
    Write-Host ""
} finally {
    # Drop plaintext locals and helper functions; the values live only in
    # the process environment now (or were never set, on the abort paths).
    foreach ($name in @("linkwaApiKey", "linkwaBaseInput", "linkwaOrigin", "linkwaAnswer", "linkwaWebhookSecret")) {
        if (Test-Path "variable:$name") { Remove-Variable $name -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item Function:\Read-LinkwaSecretValue -ErrorAction SilentlyContinue
    Remove-Item Function:\Test-LinkwaHttpsOrigin -ErrorAction SilentlyContinue
}
