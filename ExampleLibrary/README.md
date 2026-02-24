# ExampleLibrary — Test COM Registration, Hashing & Packaging

A self-contained example library for testing the Library Manager's:

- **COM registration** (`RegAsm.exe /codebase`)
- **File hashing** (SHA-256 integrity checks via `cli.js`)
- **Package creation** (`node cli.js create-package`)
- **Import/export** round-trip

## Directory Layout

```
ExampleLibrary/
├── ExampleComHelper.hsl          ← HSL library (main)
├── ExampleComHelperEnu.hs_       ← HSL string table
├── ExampleComHelper.bmp          ← Library icon (auto-detected)
├── ExampleComHelper.dll          ← COM DLL (place here after build)
├── spec.json                     ← Package spec for cli.js
├── README.md                     ← This file
├── ComDll/                       ← C# COM-visible DLL project
│   ├── ExampleComHelper.csproj
│   ├── ExampleComHelper.sln
│   ├── IExampleComHelper.cs
│   ├── ExampleComHelperClass.cs
│   └── Properties/
│       └── AssemblyInfo.cs
└── demo/
    └── Demo_ExampleComHelper.hsl ← Demo method
```

## Quick Start

### 1. Build the COM DLL

```powershell
cd ComDll
dotnet build -c Release
```

The DLL will be at `ComDll\bin\Release\net48\ExampleComHelper.dll`.
Copy it to this directory (next to the .hsl files):

```powershell
copy ComDll\bin\Release\net48\ExampleComHelper.dll .
```

### 2. Test COM Registration (manual — requires elevation)

```powershell
# Register
& "C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe" /codebase ExampleComHelper.dll

# Verify (PowerShell)
$obj = New-Object -ComObject ExampleComHelper.Calculator
$obj.Add(2, 3)    # → 5
$obj.Multiply(4, 7)  # → 28
$obj.Concat("Hello, ", "World!")  # → "Hello, World!"

# Unregister
& "C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe" /unregister ExampleComHelper.dll
```

### 3. Test Hashing

```powershell
cd ..   # back to Library Manager root
node cli.js create-package --spec ExampleLibrary/spec.json --output ExampleLibrary/out/ExampleComHelper.hxlibpkg
```

### 4. Test Import

```powershell
node cli.js import-lib --file ExampleLibrary/out/ExampleComHelper.hxlibpkg --lib-dir ExampleLibrary/test-install/Library --met-dir ExampleLibrary/test-install/Methods --force
```

### 5. Verify Installed Hashes

```powershell
node cli.js list-libs --json
```

The `file_hashes` object should contain SHA-256 hashes for:
- `ExampleComHelper.hsl`
- `ExampleComHelperEnu.hs_`
- `ExampleComHelper.dll` (because it's in `com_register_dlls`)
