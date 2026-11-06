@echo off
rem Stable copy: builds a snapshot of the game and serves it without file watching,
rem so code edits (by you or other sessions) never restart the game you are playing.
cd /d "%~dp0"
if not exist node_modules call npm install
call npx vite build --logLevel warn
start "" http://127.0.0.1:5180/
npx vite preview --port 5180 --strictPort --host 127.0.0.1
