@echo off
title Generar Trading Pedro.html
cd /d "%~dp0"
set PYTHONUTF8=1
echo Generando el archivo para enviar...
echo.
python construir_html.py
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo generar el archivo. Avisa a Claude con una foto de esta ventana.
) else (
  echo.
  echo Listo. Envia "Trading Pedro.html", que esta en esta misma carpeta.
)
echo.
pause
