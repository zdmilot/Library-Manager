# Two-Tier Update System

Library Manager supports two update modes:

## Full Update (UAC required)
Used when a release changes system-level components:
- Main executable (`Library Manager.exe`)
- NW.js runtime DLLs (`.dll` files)
- COM object (`VenusLibraryManager.dll`)
- Installer/uninstaller behavior

The full update downloads and runs the Inno Setup installer, which triggers a UAC prompt.

## Lightweight Update (no UAC)
Used when a release only changes application-level files:
- UI files (`html/`, `assets/`, `icons/`)
- Application logic (`lib/*.js`, `cli.js`)
- Tools (`tools/`)
- Documentation, legal, and configuration files

Lightweight updates download a patch ZIP and extract it directly over the install
directory. The installer grants write permissions on these directories, so no
admin privileges are needed.

## How to Release a Lightweight Update

1. Build only the changed files (no new DLLs, EXE, or COM changes).

2. Create a patch ZIP with the changed files, preserving their relative paths
   from the app root. Example:

   ```
   html/js/main.js
   html/css/main.css
   lib/shared.js
   package.json
   ```

3. Name the ZIP: `LibraryManager_v<VERSION>_patch.zip`

4. Create an `update-manifest.json`:

   ```json
   {
     "updateType": "lightweight",
     "patchAsset": "LibraryManager_v3.0.3_patch.zip"
   }
   ```

   For full updates, use `"updateType": "full"` (or omit the manifest entirely).

5. Attach both files to the GitHub release alongside the regular Setup .exe.

## How the Updater Decides

1. Checks if the GitHub release has an `update-manifest.json` asset.
2. If found and `updateType` is `"lightweight"`, and a `_patch.zip` asset exists:
   - Downloads the patch ZIP (smaller, faster).
   - Extracts files over the install directory (no UAC prompt).
   - Validates all files are in allowed directories before extraction.
   - Restarts the app.
3. If the manifest is missing, `updateType` is `"full"`, or lightweight fails:
   - Falls back to downloading and running the full Setup .exe installer.

## Security

- Patch ZIPs are validated: only files in allowed directories are extracted.
- Path traversal is blocked.
- If a lightweight patch fails for any reason, it automatically falls back to the
  full installer (which is always safe).

## Allowed Directories for Lightweight Patches

These directories have `users-modify` permissions set by the installer:

- `html/` (and subdirectories)
- `lib/`
- `assets/`
- `icons/`
- `tools/`
- `local/`

Root-level files that can be patched:
- `package.json`, `cli.js`, `com-bridge.js`, `cli-schema.json`
- `cli-spec-example.json`, `README.md`, `LICENSE`, `NOTICE`
- `PRIVACY_POLICY.txt`, `TERMS_OF_USE.txt`, `Library Manager.chm`

Files **not** patchable without admin (require full installer):
- `Library Manager.exe`, `*.dll`, `*.pak`, `*.dat`, `*.bin`
- `com/VenusLibraryManager.dll` (requires RegAsm registration)
- `locales/*`, `swiftshader/*`
