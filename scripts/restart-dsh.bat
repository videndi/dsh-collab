@echo off
setlocal
rem dsh-collab: restart DSH with logging. ASCII only - PS 5.1 misreads UTF-8 without BOM.
set "LOG=D:\dsh\collab-plugin\restart.log"
set "EXE=D:\Users\yunan\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
set "DELAY=%~1"
if "%DELAY%"=="" set "DELAY=20"

echo [%date% %time%] scheduled delay=%DELAY%s>>"%LOG%"
timeout /t %DELAY% /nobreak >nul
echo [%date% %time%] waking>>"%LOG%"

taskkill /IM "DeepSeek Harness.exe" /T /F >>"%LOG%" 2>&1
timeout /t 3 /nobreak >nul

if exist "%EXE%" (
  echo [%date% %time%] starting>>"%LOG%"
  start "" "%EXE%"
) else (
  echo [%date% %time%] EXE NOT FOUND>>"%LOG%"
)
exit /b 0
