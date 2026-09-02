@echo off
title Rakazo Portable
cd /d "%~dp0"

rem Node embarque dans le paquet, sinon celui du systeme.
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" -v >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable.
  echo   Ce paquet doit contenir un dossier "runtime" avec node.exe,
  echo   ou Node.js doit etre installe sur la machine ^(https://nodejs.org^).
  echo.
  pause
  exit /b 1
)

echo   Demarrage de Rakazo Portable...
"%NODE%" server.mjs
echo.
echo   Rakazo s'est arrete.
pause
