@echo off
setlocal
set RUSTUP_HOME=D:\Program Files\Rust
set CARGO_HOME=D:\Program Files\.cargo
set PATH=D:\Program Files\.cargo\bin;%PATH%
cd /d "%~dp0"
call npm run tauri:build:windows
