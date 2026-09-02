@echo off
REM Nexus OS job agent - daily runner
REM Registered with Windows Task Scheduler (see README).
REM Writes jobs-feed.json and appends a dated digest to agent-log.txt
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.>> agent-log.txt
echo ==================================================>> agent-log.txt
echo RUN %DATE% %TIME%>> agent-log.txt

node "%~dp0feed-agent.mjs" >> agent-log.txt 2>&1

endlocal
