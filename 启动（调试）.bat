@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
