@echo off
setlocal
if not exist "%~dp0pixel-tools\.venv\Scripts\pythonw.exe" (
  echo Missing tool environment. Run pixel-tools\Install.ps1 first.
  pause
  exit /b 1
)
set PYTHONDONTWRITEBYTECODE=1
start "" "%~dp0pixel-tools\.venv\Scripts\pythonw.exe" "%~dp0pixel-tools\pixel_tools.py" --editor %*
