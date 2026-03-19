<<<<<<< Updated upstream
# Changelog

<!--
  Edit this file with the release notes for the next version BEFORE
  triggering the "Build and Release" workflow.

  Use standard Markdown: headings, bullet lists, code fences, etc.
  Everything between the "Changelog" heading and the end of the file
  will appear as the GitHub Release body.

  After a successful release, this file is automatically reset to this
  template so it is ready for the next release cycle.
-->
=======

**1. Replaced all 10 `comRegisterMultipleDlls` call sites** with `comRegisterMultipleDllsNoUac` (per-user HKCU registration, no UAC ever):
- Rollback deregistration & re-registration
- Archive batch import
- Delete library deregistration  
- Batch import
- Single import (library COM + bin COM)
- Re-register button
- Store install (library COM + bin COM)

**2. Updated all UAC-related dialog text**:
- Re-register dialog: Unified into a single prompt (removed OEM vs non-OEM branch, removed "requires administrator" text)
- Archive import: Simplified COM scan (removed OEM verification scanning), merged two-branch prompt into single neutral prompt
- Delete confirmation HTML: Replaced admin/OEM toggle with simple "COM objects will be deregistered automatically" notice
- Removed unused `_delOemVerified`, `archiveAllOemVerified`, `_reregOemVerified` variables

**3. Added post-registration COM verification** in all flows:
- **Single import**: After successful registration, calls `checkCOMRegistrationStatus` on each DLL; if verification fails, prompts user to abort (failed = cleanup + abort) or continue (sets `comWarning`)
- **Store install**: Same verification pattern as single import
- **Bin COM** (both import + store): Verification after registration, sets `binComWarning` on failure
- **Batch import**: Verifies each library's DLLs after batch registration; only marks `com_registered: true` if verification passes
- **Archive import**: Same verification as batch import

**4. Updated SRI hashes**:
- Recomputed SHA-384 for main.js: `sha384-PKxvxk9v35CbeZT827jWDMr1EfCFHPIxs11FtkIjxqYrrXfrXcPhQylHk19RnPus`
- Updated in both sri-hashes.txt and index.html
- main.css and bs4-compat.css unchanged — hashes verified matching
>>>>>>> Stashed changes
