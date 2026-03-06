# Code Map: cli.js

**File**: `cli.js` | **Lines**: 2816 | **Purpose**: CLI entry point for library management commands

## Imports

| Line | Module |
|------|--------|
| L35  | `fs` |
| L36  | `path` |
| L37  | `os` |
| L38  | `adm-zip` |
| L39  | `crypto` |
| L40  | `./lib/shared` |

### Shared Module Re-exports (L41–60)
`safeZipExtractPath`, `isValidLibraryName`,
`signPackageZip`, `signPackageZipWithCert`, `verifyPackageSignature`,
`parseHslMetadataFooter`, `generateSigningKeyPair`, `buildPublisherCertificate`,
`validatePublisherCertificate`,
`CONTAINER_MAGIC_PKG`, `CONTAINER_MAGIC_ARC`, `packContainer`, `unpackContainer`,
`isRestrictedAuthor`, `validateAuthorPassword`,
`extractPublicFunctions`, `extractHslIncludes`, `computeLibraryHashes`

## Constants

| Line | Name | Value |
|------|------|-------|
| L63  | `MIME_MAP` | `shared.IMAGE_MIME_MAP` |
| L65  | `HSL_METADATA_EXTS` | `shared.HSL_METADATA_EXTS` |
| L67  | `DEFAULT_LIB_PATH` | `C:\Program Files (x86)\HAMILTON\Library` |
| L68  | `DEFAULT_MET_PATH` | `C:\Program Files (x86)\HAMILTON\Methods` |
| L72  | `LOCAL_DATA_DIR` | `path.join(__dirname, 'local')` |
| L73  | `PACKAGE_STORE_DIR` | `path.join(LOCAL_DATA_DIR, 'packages')` |
| L78  | `DEFAULT_GROUPS` | `{gAll, gRecent, gStarred, gFolders, gEditors, gHistory, gOEM}` |

## Utility Functions

| Line | Function | Purpose |
|------|----------|---------|
| L92  | `getGroupById(db, id)` | Look up group by ID |
| L100 | `loadSystemLibIds()` | Load system lib IDs (cached) |
| L114 | `loadSystemLibNames()` | Load system lib names (cached) |
| L120 | `isSystemLibrary(libId)` | Check system lib by ID |
| L124 | `isSystemLibraryByName(libName)` | Check system lib by name |
| L147 | `parseArgs(argv)` | Minimal --key value argument parser |
| L185 | `getWindowsUsername()` | Get current Windows username |
| L199 | `getVENUSVersion()` | Detect VENUS version from registry (uses `execFileSync`) |
| L240 | `appendAuditTrailEntry(userDataDir, entry)` | Append to audit trail JSON |
| L277 | `buildAuditTrailEntry(eventType, details)` | Build audit entry with env fields |
| L297 | `connectDB(dbDir)` | Connect diskdb |
| L307 | `resolveDBPath(args)` | Resolve DB path from CLI args |
| L321 | `ensureLocalDataDir(dirPath)` | Create local data dir with seeds |
| L350 | `warnIfSystemPath(dirPath, label)` | Warn if path is system-critical |
| L364 | `getInstallPaths(db, libDirOvr, metDirOvr)` | Resolve install paths |
| L407 | `extractRequiredDependencies(libFiles, libBasePath)` | Extract HSL dependencies |

## Core Package Operations

| Line | Function | Purpose |
|------|----------|---------|
| L457 | `autoAddToGroup(db, savedLibId, authorName)` | Add lib to nav tree group |
| L540 | `installPackage(manifest, zip, libDestDir, demoDestDir, ...)` | Core installer (7 params) |
| L672 | `ensureOutDir(filePath)` | Create parent directories |
| L688 | `getPackageStoreDir(args)` | Resolve package store directory |
| L701 | `buildCachedPackageName(libName, version)` | Build versioned package filename |
| L725 | `cachePackage(pkgBuffer, libName, version, args)` | Cache package for rollback |
| L744 | `listCachedVersions(libName, args)` | List cached package versions |
| L797 | `findLibrary(db, args)` | Find lib by _id or name |

## Command Handlers

| Line | Function | CLI Command | Purpose |
|------|----------|-------------|---------|
| L810 | `cmdListLibs(args)` | `list-libs` | List installed libraries |
| L863 | `cmdImportLib(args)` | `import-lib` | Import single .hxlibpkg |
| L1026 | `cmdImportArchive(args)` | `import-archive` | Import .hxlibarch archive |
| L1163 | `cmdExportLib(args)` | `export-lib` | Export library as .hxlibpkg |
| L1257 | `cmdExportArchive(args)` | `export-archive` | Export libraries as .hxlibarch |
| L1409 | `cmdDeleteLib(args)` | `delete-lib` | Delete installed library |
| L1585 | `cmdCreatePackage(args)` | `create-package` | Create .hxlibpkg from spec |
| L1803 | `cmdGenerateSyslibHashes(args)` | `generate-syslib-hashes` | Generate system lib baseline |
| L1918 | `cmdVerifySyslibHashes(args)` | `verify-syslib-hashes` | Verify system lib integrity |
| L2068 | `cmdListVersions(args)` | `list-versions` | List cached package versions |
| L2104 | `cmdRollbackLib(args)` | `rollback-lib` | Rollback to cached version |
| L2230 | `printHelp()` | `help` | Print usage/help text |
| L2499 | `cmdVerifyPackage(args)` | `verify-package` | Verify package signatures |
| L2667 | `cmdGenerateKeypair(args)` | `generate-keypair` | Generate Ed25519 keypair |
| L2733 | `cmdListPublishers(args)` | `list-publishers` | List publisher certificates |

## Signing Helpers

| Line | Function | Purpose |
|------|----------|---------|
| L2610 | `resolvePublisherRegistryPath()` | Get publisher registry file path |
| L2620 | `loadSigningCredentials(keyPath, certPath)` | Load key + cert from disk |
| L2646 | `resolveSigningArgs(args)` | Resolve signing CLI args |

## Main Dispatcher

| Line | Purpose |
|------|---------|
| L2779 | `die(msg)` — exit with error |
| L2786 | Main dispatcher switch on `process.argv[2]` |

## Known Issues — None Remaining

All previously identified issues in cli.js have been resolved.
