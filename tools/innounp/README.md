# innounp — Inno Setup Unpacker

This directory should contain `innounp.exe`, used by the Library Manager in-app
delta updater to extract Inno Setup installer `.exe` files without running the
installer or requiring UAC elevation.

## Download

Download `innounp.exe` from the official source:
https://innounp.sourceforge.net/

Place the executable in this directory as `innounp.exe`.

## How It's Used

During an in-app update, Library Manager:
1. Downloads the release `.exe` (Inno Setup installer) from GitHub
2. Uses `innounp.exe -x` to extract the installer contents to a staging directory
3. Compares SHA-256 hashes of staged files vs. installed files (delta resolution)
4. Copies only changed/new files to the install directory (no UAC required)
5. Restarts the application

This eliminates the need for UAC prompts, Inno Setup UI, and COM re-registration
on every update — the update happens entirely within the app with a progress bar.
