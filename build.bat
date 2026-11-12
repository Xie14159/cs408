@echo off
cd /d "D:\考研备考\408\zhenti"
call npm run build
echo Copying static...
if exist ".next\standalone\.next\static" rmdir /s /q ".next\standalone\.next\static"
xcopy ".next\static" ".next\standalone\.next\static\" /E /I /Y
echo Copying public...
if exist ".next\standalone\public" rmdir /s /q ".next\standalone\public"
xcopy "public" ".next\standalone\public\" /E /I /Y
echo Restarting server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /PID %%a /F
timeout /t 2 /nobreak >nul
start "" /B "C:\nvm4w\nodejs\node.exe" ".next\standalone\server.js"
echo Done.
