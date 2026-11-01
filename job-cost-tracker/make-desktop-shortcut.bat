@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desk = [Environment]::GetFolderPath('Desktop');" ^
  "$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Job Cost.lnk'));" ^
  "$lnk.TargetPath = '%~dp0start-windows.bat';" ^
  "$lnk.WorkingDirectory = '%~dp0';" ^
  "$lnk.IconLocation = '%~dp0job-cost.ico';" ^
  "$lnk.WindowStyle = 7;" ^
  "$lnk.Description = 'Start Job Cost Tracker';" ^
  "$lnk.Save()"
if errorlevel 1 (
  echo Could not create the shortcut.
) else (
  echo Done! A "Job Cost" icon is now on your desktop.
)
pause
