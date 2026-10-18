@echo off
title Trading Pedro
cd /d "%~dp0"
set PYTHONUTF8=1
echo Iniciando Trading Pedro... (cierra esta ventana para apagarlo)
python trading_pedro.py
pause
