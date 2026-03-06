@echo off
REM ============================================================================
REM Build VenusLibraryManager COM DLL  (32-bit / x86)
REM
REM Prerequisites:
REM   - .NET Framework 4.8 Developer Pack (or .NET 4.8 runtime minimum)
REM   - MSBuild or csc.exe from .NET Framework
REM
REM This script uses the 32-bit C# compiler from .NET Framework v4.0.30319
REM to ensure the output DLL is 32-bit compatible for VENUS.
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
set OUTDIR=bin
set DLLNAME=VenusLibraryManager.dll

echo.
echo  =============================================
echo   Building VenusLibraryManager COM DLL (x86)
echo  =============================================
echo.

REM Check for C# compiler
if not exist "%CSC%" (
    echo ERROR: Cannot find 32-bit C# compiler at:
    echo   %CSC%
    echo.
    echo Please install .NET Framework 4.8 or later.
    exit /b 1
)

REM Create output directory
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

echo Compiling LibraryManager.cs ...
"%CSC%" /target:library /out:"%OUTDIR%\%DLLNAME%" /platform:x86 ^
    /reference:System.dll ^
    /reference:System.Runtime.InteropServices.dll ^
    /warn:4 /optimize+ ^
    LibraryManager.cs

if errorlevel 1 (
    echo.
    echo ERROR: Compilation failed.
    exit /b 1
)

echo.
echo SUCCESS: %OUTDIR%\%DLLNAME% built successfully.
echo.
echo To register for COM (requires Administrator):
echo   register-com.bat
echo.
echo To verify registration:
echo   verify-com.bat
echo.

exit /b 0
