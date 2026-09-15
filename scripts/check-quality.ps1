# VSLingo Consolidated Quality Verification Script (Non-interactive)
$ErrorActionPreference = "Stop"

function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

Write-Host "=== 1/2 Backend Quality Checks ===" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\backend"
uv sync --frozen --all-groups
Assert-NativeSuccess "uv sync"
uv lock --check
Assert-NativeSuccess "uv lock --check"
uv run ruff check app tests
Assert-NativeSuccess "ruff"
uv run mypy
Assert-NativeSuccess "mypy"
uv run pytest
Assert-NativeSuccess "pytest"

Write-Host "=== 2/2 Frontend & E2E Quality Checks ===" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\frontend"
pnpm install --frozen-lockfile
Assert-NativeSuccess "pnpm install"
pnpm run check
Assert-NativeSuccess "frontend check"
pnpm run test
Assert-NativeSuccess "frontend tests"
pnpm run build
Assert-NativeSuccess "frontend build"
$env:PLAYWRIGHT_HTML_OPEN = "never"
pnpm run test:e2e
Assert-NativeSuccess "Playwright E2E"

Set-Location "$PSScriptRoot\.."
git diff --check
Assert-NativeSuccess "git diff --check"

Write-Host "=== VSLingo All Quality Checks Passed! ===" -ForegroundColor Green
