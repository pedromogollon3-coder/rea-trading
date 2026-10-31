@echo off
title Instalar IA Kronos
cd /d "%~dp0"
set PYTHONUTF8=1
echo ============================================
echo   Instalando la IA Kronos para Trading Pedro
echo   (descarga unos 300 MB; puede tardar varios minutos)
echo ============================================
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro Python. Primero usa "1_Instalar Trading Pedro.bat".
  pause
  exit /b 1
)
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto fallo
python -m pip install -r requirements-kronos.txt
if errorlevel 1 goto fallo
echo.
echo Descargando el modelo Kronos y haciendo una prueba...
python kronos_ia.py
if errorlevel 1 goto fallo
echo.
echo Listo. Abre "Trading Pedro.bat": la tarjeta "Prediccion IA" ya funciona.
pause
exit /b 0
:fallo
echo.
echo [ERROR] Fallo la instalacion de la IA. Revisa tu conexion a internet y avisa a Pedro.
echo Trading Pedro sigue funcionando sin la IA.
pause
exit /b 1
