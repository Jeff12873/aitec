@echo off
rem Lance IASSITEC sous Windows : demarre le serveur local, qui ouvre ensuite le navigateur.
rem Fermer cette fenetre arrete IASSITEC.
chcp 65001 >nul
cd /d "%~dp0"
title IASSITEC

:demarrer
"moteur\node\node.exe" serveur\demarrer.js %*
rem 42 = redemarrage demande (apres une mise a jour)
if %errorlevel%==42 goto demarrer
