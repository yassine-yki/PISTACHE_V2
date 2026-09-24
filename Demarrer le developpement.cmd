@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez Node.js puis rouvrez ce lanceur.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm est introuvable. Installez pnpm puis rouvrez ce lanceur.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Dependances absentes. Executez pnpm install dans ce dossier puis relancez.
  pause
  exit /b 1
)
echo Developpement : http://127.0.0.1:5173
echo Les modifications sont rechargees automatiquement. Ctrl+C pour arreter.
call pnpm dev --open
if errorlevel 1 (
  echo Echec du demarrage. Consultez le message ci-dessus.
  pause
)
