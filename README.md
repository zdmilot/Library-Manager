# Library Manager

Library Manager is a desktop tool (NW.js + Node.js) for managing Hamilton VENUS libraries and related assets.
It supports full package lifecycle workflows for `.hxlibpkg` and `.hxlibarch` files, including package creation, import, export, archive bundling, integrity checks, COM registration workflows, grouping, and visualization of installed libraries.

---

## What this software can do (detailed capability list)

## 1) Library management and visualization

- Displays installed libraries as visual cards with:
  - Library icon/image (embedded image if available, fallback icon otherwise)
  - Name, version, author, short description, and tags
  - Status badges (COM badge, COM warning, deleted state)
  - Integrity status indicator (error/warning/info)
- Provides a **library detail modal** for each installed library showing:
  - Full metadata (name, version, author, organization, VENUS compatibility, created date, installed date)
  - Full description and tags
  - Library image preview
  - Complete lists of installed library files and demo method files
  - Install paths for library and demo folders
  - COM registration details and warning/success state
  - File integrity verification results (missing/modified files, warnings)
- Supports visualization modes/tabs:
  - **All** installed libraries
  - **Recent** imported libraries (limited by configurable max)
  - **Import** tab view
  - **Custom group filtered views**
- Shows empty-state guidance in each view (no libraries, no recent imports, no group assignments).
- Uses card styling to surface health/quality states:
  - Integrity error style
  - COM warning style
  - Deleted style

## 2) Importing a single library package (`.hxlibpkg`)

- Lets the user browse and select one package file.
- Reads package contents and validates required `manifest.json`.
- Shows a **pre-install preview modal** including:
  - Library metadata
  - Embedded icon/image
  - Library/demo file lists
  - COM DLL indicators and COM notice
  - Destination install paths
  - Existing-library overwrite/update warning if same library name already exists
- Installs package content to VENUS paths:
  - Library files -> `...\Hamilton\Library\<LibraryName>`
  - Demo files -> `...\Hamilton\Methods\Library Demo Methods\<LibraryName>`
- Registers selected COM DLLs during import (UAC elevation flow).
- Handles COM registration failures with user decision:
  - Continue import with warning status, or
  - Cancel import and clean up extracted files.
- Updates installed library database record with:
  - Metadata + file lists + install paths
  - COM registration list and warning state
  - Source package filename
  - Install timestamp
  - Integrity hash map for tracked files
- Auto-assigns newly installed libraries into a custom group (or creates a default `Libraries` group if needed).
- Shows a post-install success modal with:
  - Installed file count
  - Output paths
  - COM registration outcome summary

## 3) Importing a library archive (`.hxlibarch`) with multiple libraries

- Supports archive selection via dedicated **Import Archive** workflow.
- Validates archive exists and contains at least one `.hxlibpkg` entry.
- Shows pre-install confirmation listing all contained packages.
- Extracts and installs each package sequentially.
- For each package, performs:
  - Manifest load
  - File extraction to library/demo destinations
  - Database upsert of installed record
  - Integrity hash computation
  - Optional auto-group assignment based on settings
- Produces aggregate completion summary with per-library success/failure entries.
- Refreshes library card visualization after import completes.

## 4) Exporting a single installed library (`.hxlibpkg`)

- Exports directly from an installed library detail modal.
- Uses a save dialog with suggested `<LibraryName>.hxlibpkg` filename.
- Rebuilds package from currently installed files and metadata.
- Includes:
  - `manifest.json`
  - `library/` payload
  - `demo_methods/` payload
  - Metadata including tags, image base64, COM DLL list
- Verifies expected library files exist before export; aborts with message if missing.

## 5) Exporting mutable libraries to an archive (`.hxlibarch`)

- Provides archive export modal listing all non-deleted installed libraries.
- Supports selection workflows:
  - Individual checkbox selection
  - Select all
  - Select none
- Exports selected libraries into one `.hxlibarch` file.
- For each selected library, builds an inner `.hxlibpkg` from **current installed state** (supports mutable/changed installations).
- Produces an archive with:
  - Multiple embedded `.hxlibpkg` files
  - `archive_manifest.json` (archive metadata, count, included library names)
- Displays export summary including included libraries and file counts.

## 6) Deleting a library

- Supports delete action from library detail modal.
- Shows explicit irreversible confirmation with:
  - Library and demo install paths
  - COM DLL deregistration implications
- Performs optional COM deregistration before file removal.
- Handles deregistration failures with continue/cancel decision.
- Deletes installed library files and demo method files from disk.
- Removes now-empty library/demo directories when possible.
- Soft-deletes database entry (marks `deleted=true` and stores `deleted_date`) so deletion history can persist.
- Removes deleted library from group assignment tree.

## 7) Creating a library package from raw files

- Built-in **Library Packager** UI creates `.hxlibpkg` from selected raw files.
- Captures metadata fields:
  - Author (required)
  - Organization
  - Library version (required)
  - VENUS compatibility string
  - Description
  - Tags
- Supports adding payload from:
  - Individual files
  - Whole folders
- Supports separate payload categories:
  - Library files
  - Demo method files
- Auto-detects library name based on file priority:
  - `.hsl` -> `.hs_` -> `.smt`
- Supports manual override of detected library name with warning UI.
- Supports optional custom icon/image selection with size/type handling.
- Auto-detects matching `.bmp` when custom image not supplied.
- Supports per-DLL **COM Register** selection inside package payload.
- Writes package with standardized structure (`manifest.json`, `library/`, `demo_methods/`, optional `icon/`).
- Includes package reset workflow to clear all staged metadata/files.

## 8) File integrity and change visualization

- Computes SHA-256 hashes for tracked files during install:
  - `.hsl`, `.hs_`, `.sub` (hashes all except last line)
  - COM-registered `.dll` files (full-file hash)
- Stores file hash map in installed library records.
- Verifies integrity when building library cards/detail view.
- Surfaces integrity states visually:
  - Modified file
  - Missing file
  - Legacy/no-hash warning
  - “All tracked files pass” success

## 9) Library grouping and organization

- Supports custom library groups (create, rename, delete).
- Supports drag-and-drop reorder of groups and group contents in settings.
- Supports drag-and-drop assignment/movement of libraries across groups.
- Provides “Unassigned Libraries” pseudo-group in settings for ungrouped items.
- Supports favorite/show-hide behavior for custom group visibility in navigation.
- Persists group + assignment tree structure via local DB JSON.

## 10) Recent/history and housekeeping

- Tracks recent imports and exposes Recent view.
- Supports configurable recent list size.
- Supports clearing recent list.
- Includes run-log cleanup progress UI and configurable history archive folder behavior in logic.

## 11) VENUS integration and utility launching

- Resolves VENUS install paths dynamically from registry via helper DLL interop.
- Updates internal path references (bin/config/library/log/methods/labware).
- Exposes launch/open actions for VENUS tools and folders (from configured links database):
  - Method Editor
  - Liquid Class Editor
  - Labware Editor
  - HSL Editor
  - System Configuration Editor
  - Run Control / Version / core VENUS directories
- Supports simulation mode toggle through helper interop (`GetSimulation` / `SetSimulation`).
- Supports user/auth role display and function-protection handling integration through helper calls.

## 12) Help and UX support

- Opens local compiled help file (`Library Manager.chm`) from overflow menu.
- Includes video modal infrastructure for in-app help/tutorial playback.
- Responsive UI behavior for window resize + nav overflow handling.

## 13) Local persistence and data model

- Uses local JSON-backed storage (`diskdb`) under `db/` for:
  - Groups
  - Links
  - Settings
  - Group tree assignments
  - Installed library records
- Persists key library lifecycle metadata:
  - Source package
  - Install and delete timestamps
  - COM registration state
  - Integrity hash data

## 14) Supported package/archive formats

- `.hxlibpkg` (single library package)
  - ZIP-based container
  - `manifest.json` + payload directories
- `.hxlibarch` (multi-library archive)
  - ZIP containing multiple `.hxlibpkg`
  - `archive_manifest.json`

---

## Companion tools included in repository

The repository also includes Python desktop tools under `Library Packager/`:

- `packager.py` – standalone Tkinter packager for building `.hxlibpkg` from raw files.
- `reader.py` – standalone package reader/viewer/extractor for `.hxlibpkg`.
- `test_roundtrip.py` – package roundtrip test helper.
- C# reference projects under `Library Packager/CSharp/` for packaging/reading interop classes and testing.

---

## Notes on current behavior (important)

- The setting `chk_autoAddToGroup` is actively used during archive import grouping behavior.
- The settings `chk_confirmBeforeInstall` and `chk_overwriteWithoutAsking` are stored and surfaced in UI, but current install flow still uses preview/confirmation and explicit overwrite/update handling in code paths reviewed.
- Deleted libraries are soft-deleted in DB (kept for history state) while files are removed from disk.

---

## In short

This software provides complete library lifecycle management for Hamilton VENUS:

- Visual library management and status visualization
- Single-package import/export
- Multi-package archive import/export
- Export of mutable installed libraries to archive
- Safe deletion with COM-aware workflow
- Package creation from raw files
- Grouping, metadata, integrity validation, and local persistence
