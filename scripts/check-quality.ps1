# VSLingo Consolidated Quality Verification Script (Non-interactive)
$ErrorActionPreference = "Stop"

Write-Host "=== 1/2 Backend Quality Checks ===" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\backend"
uv sync --frozen --all-groups
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest

Write-Host "=== 2/2 Frontend & E2E Quality Checks ===" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\frontend"
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
$env:PLAYWRIGHT_HTML_OPEN = "never"
pnpm run test:e2e

Set-Location "$PSScriptRoot\.."
git diff --check

Write-Host "=== VSLingo All Quality Checks Passed! ===" -ForegroundColor Green
