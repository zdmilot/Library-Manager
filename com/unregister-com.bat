@echo off
REM ============================================================================
REM Unregister VenusLibraryManager COM DLL using 32-bit RegAsm
REM Requires: Administrator privileges
REM ============================================================================

setlocal
cd /d "%~dp0"

set REGASM=C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe
set DLL=%~dp0bin\VenusLibraryManager.dll

echo.
echo  =============================================
echo   Unregistering VenusLibraryManager COM DLL
echo  =============================================
echo.

REM Check admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo ERROR: This script requires Administrator privileges.
    echo Right-click and select "Run as administrator".
    exit /b 1
)

if not exist "%REGASM%" (
    echo ERROR: 32-bit RegAsm not found.
    exit /b 1
)

if not exist "%DLL%" (
    echo WARNING: DLL not found at %DLL%.
    echo It may already be unregistered.
    exit /b 0
)

echo Unregistering %DLL% ...
"%REGASM%" /unregister "%DLL%"

if errorlevel 1 (
    echo ERROR: Unregistration failed.
    exit /b 1
)

echo.
echo SUCCESS: COM registration removed.
echo.

exit /b 0
