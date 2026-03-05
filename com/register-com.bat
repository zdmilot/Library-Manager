@echo off
REM ============================================================================
REM Register VenusLibraryManager COM DLL using 32-bit RegAsm
REM
REM IMPORTANT: Must use 32-bit RegAsm (Framework, NOT Framework64).
REM Hamilton VENUS is a 32-bit (x86) application. Using Framework64 would
REM register in the 64-bit hive, invisible to VENUS.
REM
REM Requires: Administrator privileges
REM ============================================================================

setlocal
cd /d "%~dp0"

set REGASM=C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe
set DLL=%~dp0bin\VenusLibraryManager.dll

echo.
echo  =============================================
echo   Registering VenusLibraryManager COM DLL
echo   (32-bit RegAsm)
echo  =============================================
echo.

REM Check admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo ERROR: This script requires Administrator privileges.
    echo Right-click and select "Run as administrator".
    exit /b 1
)

REM Check for RegAsm
if not exist "%REGASM%" (
    echo ERROR: 32-bit RegAsm not found at:
    echo   %REGASM%
    echo.
    echo Please install .NET Framework 4.8 or later.
    exit /b 1
)

REM Check for DLL
if not exist "%DLL%" (
    echo ERROR: DLL not found at:
    echo   %DLL%
    echo.
    echo Run build.bat first.
    exit /b 1
)

echo Registering %DLL% ...
echo.
"%REGASM%" /codebase "%DLL%"

if errorlevel 1 (
    echo.
    echo ERROR: Registration failed. See errors above.
    exit /b 1
)

echo.
echo SUCCESS: VenusLibraryManager.LibraryManager registered for COM.
echo.
echo ProgID: VenusLibraryManager.LibraryManager
echo.
echo Usage from VBScript:
echo   Set mgr = CreateObject("VenusLibraryManager.LibraryManager")
echo   WScript.Echo mgr.ListLibraries()
echo.

exit /b 0
