@echo off
REM Your own AI model server — double-click to install once, then run every time.
REM No account, no key, no watermark, no third party. Ever.
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo [Worker] Python 3.10+ lagbe: https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist .venv (
  echo [Worker] Prothombar setup hocche, 5-15 min lagte pare (one time)...
  python -m venv .venv
  call .venv\Scripts\activate
  pip install -r requirements.txt
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install diffusers transformers accelerate safetensors
) else (
  call .venv\Scripts\activate
)
if "%SD_MODEL%"=="" set SD_MODEL=segmind/tiny-sd
echo [Worker] Cholche: http://127.0.0.1:8188 (bondho korte Ctrl+C)
echo [Worker] ZORO AI .env.local-e likhun: WORKER_URL=http://127.0.0.1:8188
uvicorn example:app --host 127.0.0.1 --port 8188
pause
