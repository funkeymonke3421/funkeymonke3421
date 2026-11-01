@echo off
title Job Cost Tracker
cd /d "%~dp0"

rem Prefer the "py" launcher; "python" can be a Microsoft Store shortcut.
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add Python to PATH" in the installer.
  pause
  exit /b 1
)

echo Checking requirements...
%PY% -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 (
  echo Could not install requirements. Check your internet connection.
  pause
  exit /b 1
)

echo.
echo Job Cost is running. Close this window to stop it.
echo.
%PY% app.py --open
pause
