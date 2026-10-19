@echo off
title Instalar Trading Pedro
cd /d "%~dp0"
echo ============================================
echo   Instalando lo necesario para Trading Pedro
echo ============================================
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] No se encontro Python en este equipo.
  echo Descargalo de https://www.python.org/downloads/ e instalalo
  echo MARCANDO la casilla "Add python.exe to PATH". Luego vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo la instalacion. Revisa tu conexion a internet y avisa a Pedro.
  pause
  exit /b 1
)
echo.
echo Listo. Ahora abre "Trading Pedro.bat" para usar el programa.
pause
