@echo off
set "CLICK_INTERVAL_APP=%~dp0work\installed\current"
cd /d "%CLICK_INTERVAL_APP%"
start "Click Interval V 1.5" "%~dp0node_modules\electron\dist\electron.exe" "%CLICK_INTERVAL_APP%"
