@echo off
REM ============================================================================
REM Verify VenusLibraryManager COM registration using VBScript
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo  =============================================
echo   Verifying VenusLibraryManager COM Object
echo  =============================================
echo.

REM Create a temp VBS script to test COM creation
set VBSFILE=%TEMP%\test_venus_com.vbs
(
echo On Error Resume Next
echo Set mgr = CreateObject("VenusLibraryManager.LibraryManager"^)
echo If Err.Number ^<^> 0 Then
echo     WScript.Echo "FAIL: Could not create COM object."
echo     WScript.Echo "Error: " ^& Err.Description
echo     WScript.Echo "Code:  " ^& Err.Number
echo     WScript.Quit 1
echo End If
echo WScript.Echo "OK: COM object created successfully."
echo WScript.Echo "Last Error: " ^& mgr.LastError
echo Set mgr = Nothing
echo WScript.Quit 0
) > "%VBSFILE%"

REM Run with 32-bit cscript (important: use SysWOW64 on 64-bit OS)
if exist "%WINDIR%\SysWOW64\cscript.exe" (
    echo Using 32-bit cscript...
    "%WINDIR%\SysWOW64\cscript.exe" //NoLogo "%VBSFILE%"
) else (
    echo Using default cscript...
    cscript //NoLogo "%VBSFILE%"
)

set RESULT=%ERRORLEVEL%

REM Clean up
del "%VBSFILE%" 2>nul

echo.
if %RESULT% equ 0 (
    echo VERIFICATION PASSED: COM object is registered and functional.
) else (
    echo VERIFICATION FAILED: COM object could not be instantiated.
    echo.
    echo Troubleshooting:
    echo   1. Run register-com.bat as Administrator
    echo   2. Ensure .NET Framework 4.8+ is installed
    echo   3. Use 32-bit RegAsm only (Framework, not Framework64^)
)

exit /b %RESULT%
