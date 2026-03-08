# hxlibpkg-extract

Portable extraction tool for Hamilton VENUS Library Manager packages (`.hxlibpkg` and `.hxlibarch`).

Unpacks packages without requiring the full Library Manager application. Useful for environments where the app cannot be installed, or for automated workflows.

## Requirements

- Node.js 12+
- `adm-zip` module (or run from within the Library Manager directory which already has it)

## Installation

```bash
npm install adm-zip
```

## Usage

```bash
# Extract a package to ./<library_name>/
node hxlibpkg-extract.js MyLibrary.hxlibpkg

# Extract to a specific directory
node hxlibpkg-extract.js MyLibrary.hxlibpkg --out C:\target\dir

# List contents without extracting
node hxlibpkg-extract.js MyLibrary.hxlibpkg --list

# Print manifest.json
node hxlibpkg-extract.js MyLibrary.hxlibpkg --manifest

# Extract an archive (.hxlibarch) containing multiple packages
node hxlibpkg-extract.js MyArchive.hxlibarch --out C:\target\dir
```

## Output Structure

```
<library_name>/
  manifest.json
  library/          # Library files (.hsl, .dll, etc.)
  demo_methods/     # Demo method files
  installer/        # Embedded installer executables (if present)
  icon/             # Package icon
```

## Security

- Path traversal protection prevents extraction outside the target directory
- HMAC-SHA256 integrity verification ensures packages have not been tampered with
- The tool will refuse to extract a corrupted or modified package
