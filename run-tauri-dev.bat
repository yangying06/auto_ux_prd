@echo off
setlocal
set RUSTUP_HOME=D:\Program Files\Rust
set CARGO_HOME=D:\Program Files\.cargo
set PATH=D:\Program Files\.cargo\bin;%PATH%
cd /d "%~dp0"

for %%P in (5173 8787) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo Stopping process %%A using port %%P...
    taskkill /PID %%A /F >nul 2>nul
  )
)

call npm run tauri:dev
