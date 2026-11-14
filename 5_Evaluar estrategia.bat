@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js. Instalalo desde https://nodejs.org y vuelve a intentar.
  pause
  exit /b 1
)
echo === Pruebas ===
node pruebas.js
echo.
if not exist "datos\BTCUSDT_1h.csv" node evaluar.js --descargar
echo === Evaluacion ===
node evaluar.js
echo.
pause
