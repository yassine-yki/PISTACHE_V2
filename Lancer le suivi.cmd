@echo off
cd /d "%~dp0"
python local_server.py
if errorlevel 1 (
  echo.
  echo Impossible de demarrer. Verifiez que Python est installe et que le port 4173 est libre.
  pause
)
