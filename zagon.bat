@echo off
rem Domači VMS – zagon strežnika na mini PC-ju z Windows (Docker Desktop)
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Ustvarjena datoteka .env - vpisite geslo, HOST_IP in po zelji TS_AUTHKEY, nato zazenite znova.
  pause
  exit /b
)
findstr /r "^TS_AUTHKEY=." .env >nul && (set PROFILI=--profile vpn) || (set PROFILI=)
docker compose %PROFILI% up -d --build
echo.
echo Streznik tece. Nastavitve: http://localhost:8080/admin/
pause
