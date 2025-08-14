# Windows setup helper for Threat-Intel
# Run from project root in an elevated or normal PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\windows-setup.ps1

$ErrorActionPreference = 'Stop'

function Find-NpmCmd {
  $candidates = @(
    "$Env:ProgramFiles\nodejs\npm.cmd",
    "$Env:ProgramFiles(x86)\nodejs\npm.cmd"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw 'npm.cmd not found. Install Node.js from https://nodejs.org/en/download/'
}

$npm = Find-NpmCmd
Write-Host "Using npm: $npm" -ForegroundColor Cyan

Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
Push-Location backend
if (Test-Path node_modules) { Write-Host "backend node_modules already exists (skipping)" -ForegroundColor DarkGray } else { & $npm install }
Pop-Location

Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location frontend
if (Test-Path node_modules) { Write-Host "frontend node_modules already exists (skipping)" -ForegroundColor DarkGray } else { & $npm install }
Pop-Location

Write-Host "Done. Start backend: cd backend; & '$npm' run dev" -ForegroundColor Green
Write-Host "Start frontend: cd frontend; & '$npm' run dev" -ForegroundColor Green
