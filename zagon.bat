@echo off
rem Domaci VMS - zagon streznika na mini PC-ju z Windows (Docker Desktop)
rem Na Windows Tailscale namestite kot obicajno aplikacijo (tailscale.com/download), ne v Dockerju.
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Ustvarjena datoteka .env - vpisite geslo in HOST_IP, nato zazenite znova.
  pause
  exit /b
)

rem stari VisionOne VMS uporablja ista vrata (8080, 8555)
docker ps --format "{{.Names}}" | findstr /b /c:"visionone-" >nul
if not errorlevel 1 (
  echo.
  echo Tece se stari VisionOne VMS, ki zaseda ista vrata:
  docker ps --format "  {{.Names}}  {{.Ports}}" | findstr /b /c:"  visionone-"
  echo.
  echo Ustavite ga z ukazom:   docker compose -p visionone down
  echo ali v .env nastavite druga vrata ^(VMS_PORT, WEBRTC_PORT^).
  echo.
  pause
  exit /b 1
)

rem Tailscale v Dockerju na Windows ne deluje (ni host omrezja) - odstranimo ga, ce je ostal od prej
docker rm -f vms-tailscale >nul 2>&1

rem AI modul se vklopi sam, ce je v .env nastavljen AI_TOKEN
set PROFILI=
findstr /r "^AI_TOKEN=." .env >nul && set PROFILI=--profile ai

docker compose %PROFILI% up -d --build --remove-orphans
if errorlevel 1 (
  echo.
  echo Zagon ni uspel. Preberite napako zgoraj.
  pause
  exit /b 1
)
echo.
echo Streznik tece. Nastavitve: http://localhost:8080/admin/
pause
