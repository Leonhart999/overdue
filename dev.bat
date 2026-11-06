@echo off
rem Development server with hot reload: the page reloads on every saved source file.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://127.0.0.1:5174/
npm run dev
