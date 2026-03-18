# Copilot Instructions — Library Manager for VENUS 6

These instructions are **mandatory** for all AI coding agents working in this repository.

---

## CRITICAL: SRI (Subresource Integrity) Hash Updates

This application uses **SRI integrity hashes** to load CSS and JS files at runtime.
If a file's content changes but its hash is not updated, **the app will fail to launch**
with "Error loading js/main.js" (or similar) on the splash screen.

### SRI-Protected Files

The following files have SHA-384 integrity hashes enforced at load time:

| File | Loaded as |
|------|-----------|
| `html/js/main.js` | script |
| `html/css/main.css` | stylesheet |
| `html/css/bs4-compat.css` | stylesheet |
| `html/js/jquery-2.1.3.min.js` | script |
| `html/js/jquery-ui.min.js` | script |
| `html/js/bootstrap.bundle.min.js` | script |
| `html/css/bootstrap.min.css` | stylesheet |
| `html/css/all.min.css` | stylesheet |

### Where Hashes Are Stored (TWO locations — both must be updated)

1. **`html/index.html`** — in the `<script>` block near the end of the file (~line 3830+),
   inside the `cssFiles` and `scripts` arrays. Each entry has an `integrity:` property.
2. **`sri-hashes.txt`** — root-level file listing hashes for the custom files
   (`main.js`, `main.css`, `bs4-compat.css`).

### MANDATORY: After Editing Any SRI-Protected File

**Every time** you modify any of the files listed above, you **MUST** do the following
before considering the task complete:

1. **Recompute the SHA-384 hash** using this PowerShell command:
   ```powershell
   $bytes = [System.IO.File]::ReadAllBytes("<full-path-to-file>")
   $sha = [System.Security.Cryptography.SHA384]::Create()
   $hash = $sha.ComputeHash($bytes)
   $b64 = [Convert]::ToBase64String($hash)
   Write-Host "sha384-$b64"
   ```

2. **Update `html/index.html`** — replace the old `integrity: 'sha384-...'` value
   for that file in the `cssFiles` or `scripts` array.

3. **Update `sri-hashes.txt`** — replace the old hash on the corresponding line
   (only applies to `main.js`, `main.css`, `bs4-compat.css`).

4. **Verify** the app can load by confirming the hash in index.html matches what
   you computed.

> **Failure to update SRI hashes will cause the application to show a white splash
> screen with "Error loading ..." and never start. This is a ship-blocking bug.**

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

- `node --check <file>` validates syntax but does **NOT** detect SRI mismatches — always recompute hashes.
- The `bin_files` and `bin_com_register_dlls` features are OEM-developer-only (hidden behind 8-click unlock).
- COM registration uses 32-bit RegAsm.exe ONLY — never Framework64 (VENUS is x86).
- Verified OEM packages skip UAC for COM registration via `comRegisterMultipleDllsNoUac()`.
- The delete flow must handle library files, help files, demo files, labware files, bin files, and COM deregistration.
- `isRestrictedAuthor()` in `lib/shared.js` controls OEM keyword matching.
- In Settings UI (and any blue header/background region), text must use the same high-contrast title color; never ship black text on a blue background.

## Testing After Changes

After any code change, always:
1. Run `node --check <modified-file>` for syntax validation
2. Recompute SRI hashes for any modified SRI-protected files (see above)
3. Verify no merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) exist
4. Ensure version consistency between `package.json` and `installer.iss`
