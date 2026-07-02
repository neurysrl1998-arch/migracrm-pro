@echo off
title MigraCRM PRO
cd /d "%~dp0"
echo ============================================
echo         MigraCRM PRO - Iniciando...
echo ============================================
echo.
if not exist "node_modules" (
  echo Primera vez: instalando componentes (necesita internet)...
  call npm install
  echo.
)
call npm start
