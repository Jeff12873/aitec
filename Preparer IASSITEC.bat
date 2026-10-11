@echo off
rem Prepare IASSITEC sous Windows (une seule fois) : installe Node dans le profil de l'utilisateur,
rem puis lance outils\preparer.js qui fait le reste (moteur d'IA, modele, raccourcis).
rem Tout est installe dans %LOCALAPPDATA%\IASSITEC : les programmes ne peuvent tourner que dans le profil.
chcp 65001 >nul
title Préparation d'IASSITEC
setlocal

set "DEST=%LOCALAPPDATA%\IASSITEC"
rem Version de Node utilisee par IASSITEC (aussi dans preparer-iassitec.sh)
set "NODE_VERSION=v24.21.0"

if exist "%DEST%\moteur\node\node.exe" goto preparer
echo Téléchargement de Node %NODE_VERSION%...
mkdir "%DEST%\moteur" 2>nul
curl.exe -L --fail -o "%DEST%\moteur\node.zip" "https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip" || goto erreur
tar.exe -xf "%DEST%\moteur\node.zip" -C "%DEST%\moteur" || goto erreur
move "%DEST%\moteur\node-%NODE_VERSION%-win-x64" "%DEST%\moteur\node" >nul || goto erreur
del "%DEST%\moteur\node.zip"

:preparer
"%DEST%\moteur\node\node.exe" "%~dp0outils\preparer.js" %*
if errorlevel 1 goto erreur
pause
exit /b 0

:erreur
echo.
echo La préparation n'est pas terminée : voir le message ci-dessus.
pause
exit /b 1
