@echo off
title Diagnostico Trading Pedro
cd /d "%~dp0"
set PYTHONUTF8=1
python diagnostico.py
echo.
pause
