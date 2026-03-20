# Copilot Instructions — Library Manager for VENUS 6

These instructions are **mandatory** for all AI coding agents working in this repository.

---

## Application Architecture

- **Runtime**: NW.js (Node-Webkit) — desktop app, NOT a web server
- **Frontend**: Vanilla JS + jQuery 2.1.3 + jQuery UI + Bootstrap 4.4.1 (BS5 modals)
- **Entry point**: `html/index.html` (set in `package.json` → `"main"`)
- **Main logic**: `html/js/main.js` (~11,000 lines, single IIFE)
- **CLI**: `cli.js` (Node.js, shares `lib/shared.js` with GUI)
- **Shared library**: `lib/shared.js` (validation, crypto, constants)
- **Settings**: `local/settings.json` (diskdb, singleton array)
- **Version**: Defined in `package.json` → `"version"` and `installer.iss` → `#define MyAppVersion`

## Key Patterns

- The `bin_files` and `bin_com_register_dlls` features are OEM-developer-only (hidden behind 8-click unlock).
- COM registration uses 32-bit RegAsm.exe ONLY — never Framework64 (VENUS is x86).
- Verified OEM packages skip UAC for COM registration via `comRegisterMultipleDllsNoUac()`.
- The delete flow must handle library files, help files, demo files, labware files, bin files, and COM deregistration.
- `isRestrictedAuthor()` in `lib/shared.js` controls OEM keyword matching.
- In Settings UI (and any blue header/background region), text must use the same high-contrast title color; never ship black text on a blue background.

## Testing After Changes

After any code change, always:
1. Run `node --check <modified-file>` for syntax validation
2. Verify no merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) exist
3. Ensure version consistency between `package.json` and `installer.iss`
