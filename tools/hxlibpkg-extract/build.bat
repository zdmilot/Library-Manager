@echo off
REM Build hxlibpkg-extract.exe from HxlibpkgExtract.cs
REM Requires .NET Framework 4.x (included with Windows 10+)

set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
set SRC=%~dp0HxlibpkgExtract.cs
set OUT=%~dp0hxlibpkg-extract.exe

echo Building hxlibpkg-extract.exe ...
"%CSC%" /out:"%OUT%" /target:exe /optimize+ /nologo /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "%SRC%"
if %ERRORLEVEL% NEQ 0 (
    echo BUILD FAILED
    exit /b 1
)
echo Built: %OUT%
