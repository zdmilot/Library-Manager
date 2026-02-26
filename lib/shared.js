/**
 * Venus Library Manager — Shared Module
 *
 * Common validation, hashing, signing, and security routines used by both
 * the GUI (main.js) and the CLI (cli.js).  Keeping these in one place
 * eliminates behavioural drift between the two entry-points.
 *
 * Usage:
 *   const shared = require('../lib/shared');   // from cli.js
 *   const shared = require('./lib/shared');     // from html/js (NW.js)
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions whose content is tracked for integrity hashing */
const HASH_EXTENSIONS = ['.hsl', '.hs_', '.sub'];

/** Extensions that carry Hamilton's metadata footer */
const HSL_METADATA_EXTS = ['.hsl', '.hs_', '.smt'];

/** MIME types for image file extensions */
const IMAGE_MIME_MAP = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp':  'image/bmp',
    '.gif':  'image/gif',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml'
};

// ---------------------------------------------------------------------------
// Package signing key
// ---------------------------------------------------------------------------
// NOTE: This key is embedded in client-side source and provides tamper-
// *detection* only ("did the package change since it was built?"), NOT
// cryptographic authenticity.  Anyone with access to this source can
// forge a valid signature.  For stronger guarantees, move signing to a
// server-side service or use asymmetric (public/private) key signing.
const PKG_SIGNING_KEY = 'VenusLibMgr::PackageIntegrity::a7e3f9d1c6b2';

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe insertion into HTML.
 * Prevents XSS when inserting user/package-supplied text into the DOM.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Filesystem safety
// ---------------------------------------------------------------------------

/**
 * Sanitize a ZIP entry filename to prevent path traversal.
 * Returns null if the resolved path escapes the target directory.
 *
 * @param {string} baseDir - The target extraction directory
 * @param {string} fname   - The ZIP entry filename
 * @returns {string|null}  Resolved safe path, or null if unsafe
 */
function safeZipExtractPath(baseDir, fname) {
    var resolved = path.resolve(baseDir, fname);
    var base = path.resolve(baseDir) + path.sep;
    if (!resolved.startsWith(base) && resolved !== path.resolve(baseDir)) return null;
    return resolved;
}

/**
 * Validate that a library name is safe for use in filesystem paths.
 * Rejects names containing path separators, '..' traversal, reserved
 * characters, and names that are empty or whitespace-only.
 * Also rejects trailing dots and spaces (invalid on Windows).
 *
 * @param {string} name
 * @returns {boolean} true if safe
 */
function isValidLibraryName(name) {
    if (!name || typeof name !== 'string') return false;
    // Path separators or traversal
    if (/[\\\/]|\.\./.test(name)) return false;
    // Reserved characters (Windows-unsafe)
    if (/[<>:"|?*]/.test(name)) return false;
    // Trailing dots or spaces (Windows path normalisation traps)
    if (/[. ]$/.test(name)) return false;
    // Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(name)) return false;
    // Empty / whitespace-only
    if (name.trim().length === 0) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Integrity hashing
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hash of a file.
 * For .hsl, .hs_, .sub files: hashes ALL BUT THE LAST LINE (the last line
 * may contain a mutable Hamilton metadata footer / timestamp).
 * For all other files (.dll, etc.): hashes the entire file.
 *
 * @param {string} filePath - Full path to the file
 * @returns {string|null} hex hash string or null on error
 */
function computeFileHash(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        var ext = path.extname(filePath).toLowerCase();
        var hash = crypto.createHash('sha256');

        if (ext === '.hsl' || ext === '.hs_' || ext === '.sub') {
            // Hash all but the last line
            var content = fs.readFileSync(filePath, 'utf8');
            var lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            if (lines.length > 1) {
                lines.pop();
            }
            hash.update(lines.join('\n'), 'utf8');
        } else {
            var buf = fs.readFileSync(filePath);
            hash.update(buf);
        }
        return hash.digest('hex');
    } catch (_) {
        return null;
    }
}

/**
 * Computes hashes for tracked library files (.hsl, .hs_, .sub) and
 * registered COM DLL files.
 *
 * @param {Array<string>} libraryFiles - filenames array
 * @param {string}        libBasePath  - base directory for library files
 * @param {Array<string>} comDlls      - COM registered DLL filenames
 * @returns {Object} map of filename -> sha256 hex hash
 */
function computeLibraryHashes(libraryFiles, libBasePath, comDlls) {
    var hashes = {};
    (libraryFiles || []).forEach(function (fname) {
        var ext     = path.extname(fname).toLowerCase();
        var isDll   = (comDlls || []).indexOf(fname) !== -1;
        var tracked = HASH_EXTENSIONS.indexOf(ext) !== -1 || isDll;
        if (tracked) {
            var h = computeFileHash(path.join(libBasePath, fname));
            if (h) hashes[fname] = h;
        }
    });
    return hashes;
}

/**
 * Parse the Hamilton HSL metadata footer from the last non-empty line of
 * a file.
 * Footer format:
 *   // $$author=NAME$$valid=0|1$$time=TIMESTAMP$$checksum=HEX$$length=NNN$$
 *
 * @param {string} filePath - full path to the file
 * @returns {Object|null} { author, valid, time, checksum, length, raw } or null
 */
function parseHslMetadataFooter(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        var text = fs.readFileSync(filePath, 'utf8');
        var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (var i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
            var line = lines[i].trim();
            if (line === '') continue;
            var m = line.match(/\$\$author=(.+?)\$\$valid=(\d)\$\$time=(.+?)\$\$checksum=([a-f0-9]+)\$\$length=(\d+)\$\$/);
            if (m) {
                return {
                    author:   m[1],
                    valid:    parseInt(m[2], 10),
                    time:     m[3],
                    checksum: m[4],
                    length:   parseInt(m[5], 10),
                    raw:      line
                };
            }
            break; // first non-empty line wasn't a footer
        }
        return null;
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Package signing — HMAC-SHA256 integrity signatures for .hxlibpkg files
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hashes of all entries in an AdmZip instance (excluding
 * signature.json).  Returns a sorted object of { entryName: sha256hex }.
 *
 * @param {AdmZip} zip
 * @returns {Object}
 */
function computeZipEntryHashes(zip) {
    var hashes = {};
    zip.getEntries().forEach(function (entry) {
        if (entry.isDirectory) return;
        if (entry.entryName === 'signature.json') return;
        var hash = crypto.createHash('sha256').update(entry.getData()).digest('hex');
        hashes[entry.entryName] = hash;
    });
    var sorted = {};
    Object.keys(hashes).sort().forEach(function (k) { sorted[k] = hashes[k]; });
    return sorted;
}

/**
 * Sign a package ZIP by computing HMAC-SHA256 over all file hashes and
 * embedding a signature.json entry.  Must be called AFTER all other entries
 * have been added and BEFORE writing the ZIP to disk.
 *
 * @param {AdmZip} zip - The AdmZip instance to sign (modified in place)
 * @returns {Object} The signature object that was embedded
 */
function signPackageZip(zip) {
    var fileHashes = computeZipEntryHashes(zip);
    var payload    = JSON.stringify(fileHashes);
    var hmac       = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(payload).digest('hex');

    var signature = {
        format_version: '1.0',
        algorithm:      'HMAC-SHA256',
        signed_date:    new Date().toISOString(),
        file_hashes:    fileHashes,
        hmac:           hmac
    };

    try { zip.deleteFile('signature.json'); } catch (_) {}
    zip.addFile('signature.json', Buffer.from(JSON.stringify(signature, null, 2), 'utf8'));
    return signature;
}

/**
 * Verify the integrity signature of a package ZIP.
 *
 * @param {AdmZip} zip
 * @returns {Object} { valid: boolean, signed: boolean, errors: string[], warnings: string[] }
 */
function verifyPackageSignature(zip) {
    var result = { valid: true, signed: false, errors: [], warnings: [] };

    var sigEntry = zip.getEntry('signature.json');
    if (!sigEntry) {
        result.signed = false;
        result.warnings.push('Package is unsigned (no signature.json). Integrity cannot be verified.');
        return result;
    }

    result.signed = true;
    var sig;
    try {
        sig = JSON.parse(zip.readAsText(sigEntry));
    } catch (e) {
        result.valid = false;
        result.errors.push('signature.json is malformed: ' + e.message);
        return result;
    }

    if (!sig.file_hashes || !sig.hmac) {
        result.valid = false;
        result.errors.push('signature.json is missing required fields (file_hashes or hmac).');
        return result;
    }

    // Recompute HMAC over stored file_hashes
    var storedPayload = JSON.stringify(sig.file_hashes);
    var expectedHmac  = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(storedPayload).digest('hex');
    if (sig.hmac !== expectedHmac) {
        result.valid = false;
        result.errors.push('HMAC mismatch \u2014 signature.json has been tampered with.');
        return result;
    }

    // Verify each file hash against actual ZIP content
    var actualHashes = computeZipEntryHashes(zip);
    var sigFiles     = Object.keys(sig.file_hashes);
    var actualFiles  = Object.keys(actualHashes);

    // Files in signature but missing from ZIP
    sigFiles.forEach(function (f) {
        if (!actualHashes[f]) {
            result.valid = false;
            result.errors.push('File listed in signature but missing from package: ' + f);
        } else if (actualHashes[f] !== sig.file_hashes[f]) {
            result.valid = false;
            result.errors.push('File hash mismatch (corrupted or modified): ' + f);
        }
    });

    // Files in ZIP but not in signature (injected)
    actualFiles.forEach(function (f) {
        if (!sig.file_hashes[f]) {
            result.valid = false;
            result.errors.push('File present in package but not in signature (injected): ' + f);
        }
    });

    return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
    // Constants
    HASH_EXTENSIONS:    HASH_EXTENSIONS,
    HSL_METADATA_EXTS:  HSL_METADATA_EXTS,
    IMAGE_MIME_MAP:     IMAGE_MIME_MAP,
    PKG_SIGNING_KEY:    PKG_SIGNING_KEY,

    // HTML escaping
    escapeHtml:         escapeHtml,

    // Filesystem safety
    safeZipExtractPath:     safeZipExtractPath,
    isValidLibraryName:     isValidLibraryName,

    // Integrity hashing
    computeFileHash:        computeFileHash,
    computeLibraryHashes:   computeLibraryHashes,
    parseHslMetadataFooter: parseHslMetadataFooter,

    // Package signing
    computeZipEntryHashes:    computeZipEntryHashes,
    signPackageZip:           signPackageZip,
    verifyPackageSignature:   verifyPackageSignature
};
