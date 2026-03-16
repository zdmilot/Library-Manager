// SPDX-License-Identifier: Apache-2.0
/**
 * Library Manager - Shared Module
 *
 * Copyright (c) 2026 Zachary Milot
 * Author: Zachary Milot
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
const os     = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current manifest format version. Increment on breaking manifest changes. */
const FORMAT_VERSION = '2.0';

/** Valid lineage event type strings. */
const VALID_LINEAGE_EVENTS = ['created', 'exported', 'repackaged'];

/**
 * Known manifest fields - keys expected in a package manifest.json.
 * Used by import/rollback to identify and preserve unknown forward-compat fields.
 */
const KNOWN_MANIFEST_KEYS = [
    'format_version','library_name','author','organization','version',
    'venus_compatibility','description','github_url','tags','created_date',
    'library_image','library_image_base64','library_image_mime',
    'library_files','demo_method_files','help_files','com_register_dlls',
    'labware_files','bin_files','dependencies',
    'app_version','windows_version','venus_version','package_lineage',
    'is_system_backup','install_to_library_root','custom_install_subdir',
    'installer_executable','installer_info',
    'release_notes','release_notes_pdf','release_notes_pdf_base64'
];

/**
 * Known installed-library DB record fields.
 * Used by export to identify and preserve unknown forward-compat fields.
 */
const KNOWN_LIB_DB_KEYS = [
    '_id','library_name','author','organization','version','venus_compatibility',
    'description','github_url','tags','created_date','library_image',
    'library_image_base64','library_image_mime','library_files',
    'demo_method_files','help_files','com_register_dlls','labware_files',
    'com_warning','com_registered',
    'lib_install_path','demo_install_path','labware_install_path','bin_install_path','installed_date','installed_by',
    'source_package','file_hashes','public_functions','required_dependencies',
    'deleted','deleted_date','app_version','format_version','windows_version',
    'venus_version','package_lineage','is_system_backup','install_to_library_root','custom_install_subdir',
    'installer_executable','installer_info','installer_path','installer_original_name','installer_size'
];

/** Default subdirectory name for cached installer executables */
const INSTALLER_STORE_DIRNAME = 'installers';

/** File extensions whose content is tracked for integrity hashing */
const HASH_EXTENSIONS = ['.hsl', '.hs_', '.sub'];

/** Extensions that carry Hamilton's metadata footer */
const HSL_METADATA_EXTS = ['.hsl', '.hs_', '.smt'];

/**
 * File extensions that are restricted for security reasons.
 * Files with these extensions are blocked from library_files,
 * demo_method_files, and labware_files unless the caller holds
 * OEM-level authorization.
 */
const RESTRICTED_FILE_EXTENSIONS = [
    // Executables & installers
    '.exe', '.msi', '.msp', '.scr', '.com', '.pif', '.appx', '.msix',
    // Scripts
    '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js',
    '.jse', '.ws', '.wsf', '.wsc', '.wsh', '.py', '.pyw', '.sh',
    // Registry
    '.reg',
    // Shortcut / link (can point to arbitrary targets)
    '.lnk', '.url', '.website',
    // System / driver
    '.sys', '.drv', '.cpl', '.inf', '.ocx',
    // Task / management console snap-ins
    '.msc', '.mst',
    // HTML applications (full trust in Windows)
    '.hta',
    // Cabinet / self-extracting archives
    '.cab', '.sfx'
];

/** MIME types for image file extensions (both dot-prefixed and bare) */
const IMAGE_MIME_MAP = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp':  'image/bmp',
    '.gif':  'image/gif',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
    'png':   'image/png',
    'jpg':   'image/jpeg',
    'jpeg':  'image/jpeg',
    'bmp':   'image/bmp',
    'gif':   'image/gif',
    'ico':   'image/x-icon',
    'svg':   'image/svg+xml'
};

/** Set of valid image MIME types for validation. */
const VALID_IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_MAP));

// ---------------------------------------------------------------------------
// Package signing key (HMAC-SHA256 tamper-detection)
// ---------------------------------------------------------------------------
// NOTE: This key is embedded in client-side source and provides tamper-
// *detection* only ("did the package change since it was built?"), NOT
// cryptographic authenticity.  Anyone with access to this source can
// forge a valid signature.  For publisher identity verification, the
// Ed25519 code signing certificate system is required.
//
// Used as part of the v2.0 signature alongside Ed25519. Legacy v1.0
// HMAC-only signatures are no longer accepted.
const PKG_SIGNING_KEY = 'VenusLibMgr::PackageIntegrity::a7e3f9d1c6b2';

// ---------------------------------------------------------------------------
// Code signing certificates (Ed25519 asymmetric signing)
// ---------------------------------------------------------------------------
// Publishers generate an Ed25519 key pair.  The private key signs packages
// at creation time; the public key (embedded in the package) validates
// origin and integrity on import.  OEM-matching certificates display the
// verified OEM badge in the GUI.
//
// Publisher certificate format (JSON):
//   {
//     "cert_format":   "hxlibpkg-publisher-cert/1.0",
//     "publisher":     "Jane Smith",
//     "organization":  "Acme Pharma",
//     "public_key":    "<base64 raw Ed25519 public key>",
//     "fingerprint":   "<SHA-256 hex of raw public key bytes>",
//     "created_date":  "<ISO 8601>",
//     "key_id":        "<first 16 chars of fingerprint>"
//   }
//
// Key file layout (PEM-encoded):
//   <publisher>.key.pem   - Ed25519 private key  (KEEP SECRET)
//   <publisher>.cert.json - Publisher certificate (distribute freely)
// ---------------------------------------------------------------------------

const CERT_FORMAT_VERSION = 'hxlibpkg-publisher-cert/1.0';

/**
 * Generate an Ed25519 key pair for code signing.
 *
 * @returns {{ privateKeyPem: string, publicKeyPem: string, publicKeyRaw: Buffer }}
 */
function generateSigningKeyPair() {
    var keypair = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    // Extract raw 32-byte public key for fingerprint / compact storage
    var pubKeyObj = crypto.createPublicKey(keypair.publicKey);
    var rawPub    = pubKeyObj.export({ type: 'spki', format: 'der' });
    // Ed25519 SPKI DER is 44 bytes: 12-byte header + 32-byte key
    var rawPubKey = rawPub.slice(rawPub.length - 32);
    return {
        privateKeyPem: keypair.privateKey,
        publicKeyPem:  keypair.publicKey,
        publicKeyRaw:  rawPubKey
    };
}

/**
 * Compute the fingerprint (SHA-256 hex) of a raw Ed25519 public key.
 *
 * @param {Buffer|string} publicKeyRaw - 32-byte raw key or base64 string
 * @returns {string} SHA-256 hex fingerprint
 */
function computeKeyFingerprint(publicKeyRaw) {
    var buf = Buffer.isBuffer(publicKeyRaw) ? publicKeyRaw : Buffer.from(publicKeyRaw, 'base64');
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a publisher certificate object from a key pair and identity info.
 *
 * @param {string} publisher     - Publisher name
 * @param {string} organization  - Organization name (may be empty)
 * @param {Buffer} publicKeyRaw  - 32-byte raw Ed25519 public key
 * @returns {Object} Publisher certificate
 */
function buildPublisherCertificate(publisher, organization, publicKeyRaw) {
    var fingerprint = computeKeyFingerprint(publicKeyRaw);
    return {
        cert_format:  CERT_FORMAT_VERSION,
        publisher:    publisher,
        organization: organization || '',
        public_key:   publicKeyRaw.toString('base64'),
        fingerprint:  fingerprint,
        key_id:       fingerprint.substring(0, 16),
        created_date: new Date().toISOString()
    };
}

/**
 * Sign a data payload with an Ed25519 private key.
 *
 * @param {string|Buffer} data          - The data to sign
 * @param {string}        privateKeyPem - PEM-encoded Ed25519 private key
 * @returns {string} Base64-encoded signature
 */
function ed25519Sign(data, privateKeyPem) {
    var privKey = crypto.createPrivateKey(privateKeyPem);
    var sig     = crypto.sign(null, Buffer.from(data), privKey);
    return sig.toString('base64');
}

/**
 * Verify an Ed25519 signature against a public key.
 *
 * @param {string|Buffer} data         - The signed data
 * @param {string}        signatureB64 - Base64-encoded signature
 * @param {string}        publicKeyB64 - Base64-encoded raw 32-byte public key
 * @returns {boolean} true if the signature is valid
 */
function ed25519Verify(data, signatureB64, publicKeyB64) {
    try {
        // Reconstruct SPKI DER from raw 32-byte key
        var rawKey  = Buffer.from(publicKeyB64, 'base64');
        // Ed25519 SPKI DER header (12 bytes) + raw key (32 bytes)
        var spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        var spkiDer    = Buffer.concat([spkiHeader, rawKey]);
        var pubKey     = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
        var sigBuf     = Buffer.from(signatureB64, 'base64');
        return crypto.verify(null, Buffer.from(data), pubKey, sigBuf);
    } catch (_) {
        return false;
    }
}

/**
 * Validate the structure of a publisher certificate object.
 *
 * @param {Object} cert
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePublisherCertificate(cert) {
    var errors = [];
    if (!cert || typeof cert !== 'object') {
        return { valid: false, errors: ['Certificate is not an object'] };
    }
    if (cert.cert_format !== CERT_FORMAT_VERSION) {
        errors.push('Unknown certificate format: ' + (cert.cert_format || '(missing)'));
    }
    if (!cert.publisher || typeof cert.publisher !== 'string') {
        errors.push('Missing or invalid publisher field');
    }
    if (!cert.public_key || typeof cert.public_key !== 'string') {
        errors.push('Missing or invalid public_key field');
    } else {
        var rawBytes = Buffer.from(cert.public_key, 'base64');
        if (rawBytes.length !== 32) {
            errors.push('public_key must be a 32-byte Ed25519 key (got ' + rawBytes.length + ' bytes)');
        }
    }
    if (!cert.fingerprint || typeof cert.fingerprint !== 'string') {
        errors.push('Missing or invalid fingerprint field');
    } else if (cert.public_key) {
        var expectedFp = computeKeyFingerprint(cert.public_key);
        if (cert.fingerprint !== expectedFp) {
            errors.push('Fingerprint does not match public key');
        }
    }
    if (!cert.key_id || typeof cert.key_id !== 'string') {
        errors.push('Missing or invalid key_id field');
    }
    return { valid: errors.length === 0, errors: errors };
}

// ---------------------------------------------------------------------------
// Binary container format
// ---------------------------------------------------------------------------
// .hxlibpkg and .hxlibarch files are wrapped in a custom binary envelope
// that makes them opaque to standard tools (Notepad, 7-Zip, WinRAR, etc.).
// The internal ZIP payload is XOR-scrambled with a repeating key and
// protected by an HMAC-SHA256 over the scrambled bytes.  Any accidental
// edit or corruption is detected and the import fails closed.
//
// Container layout (header = 48 bytes):
//   [0..7]   8 B   Magic identifier
//   [8..11]  4 B   Flags  (uint32 LE, reserved = 0)
//   [12..15] 4 B   Payload length (uint32 LE)
//   [16..47] 32 B  HMAC-SHA256 of scrambled payload
//   [48..]   N B   XOR-scrambled ZIP buffer
// ---------------------------------------------------------------------------

/** 8-byte magic for single-library packages (.hxlibpkg) */
const CONTAINER_MAGIC_PKG = Buffer.from([0x48, 0x58, 0x4C, 0x50, 0x4B, 0x47, 0x01, 0x00]); // "HXLPKG\x01\x00"

/** 8-byte magic for library archives (.hxlibarch) */
const CONTAINER_MAGIC_ARC = Buffer.from([0x48, 0x58, 0x4C, 0x41, 0x52, 0x43, 0x01, 0x00]); // "HXLARC\x01\x00"

/** 32-byte XOR scramble key - makes the ZIP payload unrecognisable */
const CONTAINER_SCRAMBLE_KEY = Buffer.from([
    0x7A, 0x3F, 0xC1, 0xD8, 0x4E, 0x92, 0xB5, 0x16,
    0xA3, 0x0D, 0xE7, 0x68, 0xF4, 0x2C, 0x59, 0x8B,
    0x31, 0xCA, 0x75, 0x0E, 0x96, 0xAF, 0xD2, 0x43,
    0xBC, 0x1A, 0x67, 0xE0, 0x58, 0x84, 0x3B, 0xF9
]);

/** Size of the fixed binary container header in bytes */
const CONTAINER_HEADER_SIZE = 48;

/**
 * Wrap a raw ZIP buffer into a binary container.
 *
 * The ZIP bytes are XOR-scrambled so the output cannot be opened by
 * standard archive tools, then protected with an HMAC-SHA256 so that
 * any accidental edit or truncation is detected on import.
 *
 * @param {Buffer} zipBuffer - The raw ZIP data (from AdmZip.toBuffer())
 * @param {Buffer} magic     - 8-byte magic identifier (CONTAINER_MAGIC_PKG or _ARC)
 * @returns {Buffer} The complete binary container
 */
function packContainer(zipBuffer, magic) {
    // XOR-scramble the payload
    var scrambled = Buffer.alloc(zipBuffer.length);
    for (var i = 0; i < zipBuffer.length; i++) {
        scrambled[i] = zipBuffer[i] ^ CONTAINER_SCRAMBLE_KEY[i % CONTAINER_SCRAMBLE_KEY.length];
    }

    // HMAC over scrambled bytes
    var hmac = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(scrambled).digest();

    // Build header: magic(8) + flags(4) + payloadLen(4) + hmac(32) = 48 bytes
    var header = Buffer.alloc(CONTAINER_HEADER_SIZE);
    magic.copy(header, 0);                        // [0..7]
    header.writeUInt32LE(0, 8);                    // [8..11]  flags (reserved)
    if (scrambled.length > 0xFFFFFFFF) {
        throw new Error('Payload exceeds maximum container size (4 GB).');
    }
    header.writeUInt32LE(scrambled.length, 12);    // [12..15] payload length
    hmac.copy(header, 16);                         // [16..47] HMAC

    return Buffer.concat([header, scrambled]);
}

/**
 * Unwrap a binary container, verify its integrity, and return the
 * original ZIP buffer.  Throws on any error (fail closed).
 *
 * @param {Buffer} containerBuffer - The raw file bytes
 * @param {Buffer} magic           - Expected 8-byte magic identifier
 * @returns {Buffer} The recovered ZIP buffer
 * @throws {Error} If the container is invalid, corrupted, or tampered with
 */
function unpackContainer(containerBuffer, magic) {
    if (!Buffer.isBuffer(containerBuffer) || containerBuffer.length < CONTAINER_HEADER_SIZE) {
        throw new Error('Invalid package: file is too small or not a valid container.');
    }

    // Check magic bytes
    if (containerBuffer.compare(magic, 0, magic.length, 0, magic.length) !== 0) {
        throw new Error('Invalid package: unrecognized file format.');
    }

    // Read header fields
    // var flags = containerBuffer.readUInt32LE(8);   // reserved - ignored for now
    var payloadLen = containerBuffer.readUInt32LE(12);
    var storedHmac = containerBuffer.slice(16, CONTAINER_HEADER_SIZE);

    if (containerBuffer.length < CONTAINER_HEADER_SIZE + payloadLen) {
        throw new Error('Invalid package: file is truncated or corrupted.');
    }

    var scrambled = containerBuffer.slice(CONTAINER_HEADER_SIZE, CONTAINER_HEADER_SIZE + payloadLen);

    // Verify HMAC (timing-safe comparison)
    var computedHmac = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(scrambled).digest();
    if (!crypto.timingSafeEqual(storedHmac, computedHmac)) {
        throw new Error('Package integrity check failed: the file has been corrupted or tampered with.');
    }

    // De-scramble to recover the ZIP buffer
    var zipBuffer = Buffer.alloc(scrambled.length);
    for (var i = 0; i < scrambled.length; i++) {
        zipBuffer[i] = scrambled[i] ^ CONTAINER_SCRAMBLE_KEY[i % CONTAINER_SCRAMBLE_KEY.length];
    }

    return zipBuffer;
}

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
 * Sanitize a relative file path for use in package manifests and ZIP entries.
 * Ensures the path is safe, portable, and cannot escape the intended directory.
 *
 * Rules:
 *  - Must be a non-empty string
 *  - No absolute paths (drive letters, leading slashes, UNC paths)
 *  - No '..' traversal segments
 *  - No null bytes or control characters
 *  - No Windows reserved characters: < > : " | ? *
 *  - No Windows reserved device names as any path segment
 *  - Normalizes backslashes to forward slashes for portability
 *  - Strips leading slashes after normalization
 *
 * @param {string} relPath - The relative path to sanitize
 * @returns {{ valid: boolean, sanitized: string|null, error: string|null }}
 */
function sanitizeManifestPath(relPath) {
    if (!relPath || typeof relPath !== 'string') {
        return { valid: false, sanitized: null, error: 'Path is empty or not a string' };
    }
    // Reject null bytes and control characters
    if (/[\x00-\x1f]/.test(relPath)) {
        return { valid: false, sanitized: null, error: 'Path contains control characters: ' + relPath };
    }
    // Reject Windows reserved characters (except backslash/forward slash which are separators)
    if (/[<>:"|?*]/.test(relPath)) {
        return { valid: false, sanitized: null, error: 'Path contains reserved characters: ' + relPath };
    }
    // Normalize separators to forward slash
    var normalized = relPath.replace(/\\/g, '/');
    // Reject absolute paths: drive letters, UNC paths, leading slash
    if (/^[a-zA-Z]:/.test(normalized)) {
        return { valid: false, sanitized: null, error: 'Path contains a drive letter (absolute path): ' + relPath };
    }
    // Strip leading slashes (defense-in-depth)
    normalized = normalized.replace(/^\/+/, '');
    if (!normalized || normalized === '.' || normalized === '..') {
        return { valid: false, sanitized: null, error: 'Path resolves to empty or traversal: ' + relPath };
    }
    // Reject '..' segments anywhere in the path
    var segments = normalized.split('/');
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (seg === '..') {
            return { valid: false, sanitized: null, error: 'Path contains ".." traversal: ' + relPath };
        }
        // Reject empty segments (double slashes)
        if (seg === '' && i < segments.length - 1) continue; // trailing slash OK
        // Reject Windows reserved device names as any segment
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(seg)) {
            return { valid: false, sanitized: null, error: 'Path contains Windows reserved name "' + seg + '": ' + relPath };
        }
        // Reject trailing dots or spaces on any segment (Windows filesystem trap)
        if (seg.length > 0 && /[. ]$/.test(seg)) {
            return { valid: false, sanitized: null, error: 'Path segment has trailing dot or space: ' + relPath };
        }
    }
    return { valid: true, sanitized: normalized, error: null };
}

/**
 * Validate all file paths in a package manifest.
 * Checks library_files, demo_method_files, help_files, and custom_install_subdir.
 *
 * @param {Object} manifest - The parsed manifest object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifestPaths(manifest) {
    var errors = [];
    var pathFields = ['library_files', 'demo_method_files', 'help_files', 'labware_files', 'bin_files'];
    for (var fi = 0; fi < pathFields.length; fi++) {
        var field = pathFields[fi];
        var files = manifest[field];
        if (!Array.isArray(files)) continue;
        for (var pi = 0; pi < files.length; pi++) {
            var result = sanitizeManifestPath(files[pi]);
            if (!result.valid) {
                errors.push(field + '[' + pi + ']: ' + result.error);
            }
        }
    }
    // Validate custom_install_subdir if present
    if (manifest.custom_install_subdir) {
        var subdirResult = sanitizeManifestPath(manifest.custom_install_subdir);
        if (!subdirResult.valid) {
            errors.push('custom_install_subdir: ' + subdirResult.error);
        }
    }
    return { valid: errors.length === 0, errors: errors };
}

/**
 * Check whether a file extension is restricted (potentially dangerous).
 *
 * @param {string} filename - Filename or path to check
 * @returns {boolean} true if the extension is restricted
 */
function isRestrictedFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return false;
    var ext = path.extname(filename).toLowerCase();
    return RESTRICTED_FILE_EXTENSIONS.indexOf(ext) !== -1;
}

/**
 * Validate that manifest file arrays do not contain restricted file types.
 * Checks library_files, demo_method_files, and labware_files.
 * Bin files are excluded (they are already gated behind OEM authorization).
 *
 * @param {Object} manifest - The parsed manifest object
 * @returns {{ valid: boolean, errors: string[], restrictedFiles: string[] }}
 */
function validateManifestFileExtensions(manifest) {
    var errors = [];
    var restrictedFiles = [];
    var fieldsToCheck = ['library_files', 'demo_method_files', 'labware_files'];
    for (var fi = 0; fi < fieldsToCheck.length; fi++) {
        var field = fieldsToCheck[fi];
        var files = manifest[field];
        if (!Array.isArray(files)) continue;
        for (var pi = 0; pi < files.length; pi++) {
            var filePath = files[pi];
            if (isRestrictedFileExtension(filePath)) {
                var ext = path.extname(filePath).toLowerCase();
                errors.push(field + ': "' + path.basename(filePath) + '" has restricted extension "' + ext + '"');
                restrictedFiles.push(filePath);
            }
        }
    }
    return { valid: errors.length === 0, errors: errors, restrictedFiles: restrictedFiles };
}

/**
 * Sanitize all file paths in a manifest to use forward slashes and strip
 * any dangerous prefixes. Returns a new manifest with cleaned paths.
 * Throws if any path is fundamentally unsafe.
 *
 * @param {Object} manifest - The manifest to sanitize (modified in place)
 * @returns {Object} The same manifest with sanitized paths
 * @throws {Error} If any path fails validation
 */
function sanitizeManifestFilePaths(manifest) {
    var pathFields = ['library_files', 'demo_method_files', 'help_files', 'labware_files', 'bin_files'];
    for (var fi = 0; fi < pathFields.length; fi++) {
        var field = pathFields[fi];
        var files = manifest[field];
        if (!Array.isArray(files)) continue;
        var sanitized = [];
        for (var pi = 0; pi < files.length; pi++) {
            var result = sanitizeManifestPath(files[pi]);
            if (!result.valid) {
                throw new Error('Unsafe path in ' + field + ': ' + result.error);
            }
            sanitized.push(result.sanitized);
        }
        manifest[field] = sanitized;
    }
    if (manifest.custom_install_subdir) {
        var subdirResult = sanitizeManifestPath(manifest.custom_install_subdir);
        if (!subdirResult.valid) {
            throw new Error('Unsafe custom_install_subdir: ' + subdirResult.error);
        }
        manifest.custom_install_subdir = subdirResult.sanitized;
    }
    // Validate image MIME type to prevent injection via data URIs
    if (manifest.library_image_mime && !VALID_IMAGE_MIMES.has(manifest.library_image_mime)) {
        manifest.library_image_mime = 'image/png'; // Default to safe value
    }
    return manifest;
}

/**
 * Sanitize a ZIP entry filename to prevent path traversal.
 * Returns null if the resolved path escapes the target directory.
 *
 * @param {string} baseDir - The target extraction directory
 * @param {string} fname   - The ZIP entry filename
 * @returns {string|null}  Resolved safe path, or null if unsafe
 */
function safeZipExtractPath(baseDir, fname) {
    if (!fname || typeof fname !== 'string') return null;
    // Strip absolute path prefixes and leading separators (defense-in-depth)
    fname = fname.replace(/^[a-zA-Z]:/, '').replace(/^[\\/]+/, '');
    if (!fname || fname === '.' || fname === '..') return null;
    var resolved = path.resolve(baseDir, fname);
    var base = path.resolve(baseDir) + path.sep;
    if (!resolved.startsWith(base)) return null;
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
    if (name.trim().length === 0) return false;
    // Only alphanumeric characters, spaces, dashes, and underscores
    if (!SAFE_NAME_REGEX.test(name)) return false;
    // Trailing spaces (invalid on Windows)
    if (/ $/.test(name)) return false;
    // Windows reserved device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9)
    if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(name)) return false;
    return true;
}

/**
 * Validate a group name: must contain only alphanumeric characters, spaces,
 * dashes, and underscores, and must not be a reserved group name.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isValidGroupName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.trim().length === 0) return false;
    if (!SAFE_NAME_REGEX.test(name)) return false;
    if (isReservedGroupName(name)) return false;
    return true;
}

/**
 * Validate an author name: must contain only alphanumeric characters, spaces,
 * dashes, and underscores, and must satisfy length constraints.
 *
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
function isValidAuthorName(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0)
        return { valid: false, reason: 'Author is required.' };
    if (name.trim().length < AUTHOR_MIN_LENGTH)
        return { valid: false, reason: 'Author must be at least ' + AUTHOR_MIN_LENGTH + ' characters.' };
    if (name.length > AUTHOR_MAX_LENGTH)
        return { valid: false, reason: 'Author cannot exceed ' + AUTHOR_MAX_LENGTH + ' characters.' };
    if (!SAFE_AUTHOR_REGEX.test(name))
        return { valid: false, reason: 'Author contains invalid characters. Only letters, numbers, spaces, dashes, underscores, and commas are allowed.' };
    return { valid: true };
}

/**
 * Validate an organization name (optional field): if provided, must contain
 * only alphanumeric characters, spaces, dashes, underscores, and commas.
 *
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
function isValidOrganizationName(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0)
        return { valid: true }; // optional field
    if (name.trim().length < AUTHOR_MIN_LENGTH)
        return { valid: false, reason: 'Organization must be at least ' + AUTHOR_MIN_LENGTH + ' characters.' };
    if (name.length > AUTHOR_MAX_LENGTH)
        return { valid: false, reason: 'Organization cannot exceed ' + AUTHOR_MAX_LENGTH + ' characters.' };
    if (!SAFE_AUTHOR_REGEX.test(name))
        return { valid: false, reason: 'Organization contains invalid characters. Only letters, numbers, spaces, dashes, underscores, and commas are allowed.' };
    return { valid: true };
}

/**
 * Validate a custom install subdirectory path.  Each segment of the path
 * must contain only alphanumeric characters, spaces, dashes, and underscores.
 * Path separators (/ or \) are allowed between segments.  Path traversal
 * (..) and absolute paths are rejected.
 *
 * @param {string} subdir
 * @returns {{ valid: boolean, reason?: string }}
 */
function isValidSubdirPath(subdir) {
    if (!subdir || typeof subdir !== 'string') return { valid: true }; // empty is ok
    var normalized = subdir.replace(/\\/g, '/');
    if (normalized.indexOf('..') !== -1) return { valid: false, reason: 'Path traversal (..) is not allowed.' };
    if (/^[a-zA-Z]:/.test(subdir) || /^\//.test(normalized) || /^\\/.test(subdir))
        return { valid: false, reason: 'Absolute paths are not allowed.' };
    var segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return { valid: true };
    for (var i = 0; i < segments.length; i++) {
        if (!SAFE_NAME_REGEX.test(segments[i]))
            return { valid: false, reason: 'Folder name "' + segments[i] + '" contains invalid characters. Only letters, numbers, spaces, dashes, and underscores are allowed.' };
        if (/ $/.test(segments[i]))
            return { valid: false, reason: 'Folder name "' + segments[i] + '" cannot end with a space.' };
        if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(segments[i]))
            return { valid: false, reason: 'Folder name "' + segments[i] + '" is a reserved Windows device name.' };
    }
    return { valid: true };
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
        if (typeof filePath !== 'string' || !filePath) return null;
        if (!fs.existsSync(filePath)) return null;
        var ext = path.extname(filePath).toLowerCase();
        var hash = crypto.createHash('sha256');

        if (HASH_EXTENSIONS.indexOf(ext) !== -1) {
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
// Package signing - HMAC-SHA256 integrity signatures for .hxlibpkg files
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
        try {
            var data = entry.getData();
            var hash = crypto.createHash('sha256').update(data).digest('hex');
            hashes[entry.entryName] = hash;
        } catch (e) {
            throw new Error('Failed to read ZIP entry "' + entry.entryName + '": ' + e.message);
        }
    });
    var sorted = {};
    Object.keys(hashes).sort().forEach(function (k) { sorted[k] = hashes[k]; });
    return sorted;
}

/**
 * Sign a package ZIP using Ed25519 code signing certificate.
 * Creates a signature_format_version 2.0 signature that includes:
 *   - File hashes (SHA-256 of each ZIP entry)
 *   - HMAC-SHA256 tamper-detection hash
 *   - Ed25519 digital signature over the file hashes
 *   - Publisher certificate (public key + identity)
 *
 * @param {AdmZip} zip               - The AdmZip instance to sign (modified in place)
 * @param {string} privateKeyPem     - PEM-encoded Ed25519 private key
 * @param {Object} publisherCert     - Publisher certificate object
 * @returns {Object} The signature object that was embedded
 */
function signPackageZipWithCert(zip, privateKeyPem, publisherCert) {
    var fileHashes = computeZipEntryHashes(zip);
    var payload    = JSON.stringify(fileHashes);

    // HMAC-SHA256 tamper-detection hash
    var hmac = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(payload).digest('hex');

    // Ed25519 digital signature over canonical file hashes JSON
    var digitalSignature = ed25519Sign(payload, privateKeyPem);

    var signature = {
        signature_format_version: '2.0',
        algorithm:           'Ed25519+HMAC-SHA256',
        signed_date:         new Date().toISOString(),
        file_hashes:         fileHashes,
        hmac:                hmac,
        digital_signature:   digitalSignature,
        publisher_certificate: {
            cert_format:  publisherCert.cert_format,
            publisher:    publisherCert.publisher,
            organization: publisherCert.organization || '',
            public_key:   publisherCert.public_key,
            fingerprint:  publisherCert.fingerprint,
            key_id:       publisherCert.key_id,
            created_date: publisherCert.created_date
        }
    };

    try { zip.deleteFile('signature.json'); } catch (_) {}
    try {
        zip.addFile('signature.json', Buffer.from(JSON.stringify(signature, null, 2), 'utf8'));
    } catch (e) {
        throw new Error('Failed to embed signature in package: ' + e.message);
    }
    return signature;
}

/**
 * Verify the integrity and code signing signature of a package ZIP.
 *
 * Returns an enhanced result object:
 *   - valid:          boolean  - overall integrity (hashes match)
 *   - signed:         boolean  - has any signature (HMAC or Ed25519)
 *   - code_signed:    boolean  - has Ed25519 publisher certificate signature
 *   - publisher_cert: Object|null - embedded publisher certificate (if code_signed)
 *   - oem_verified:  boolean  - true if publisher matches a known OEM name
 *   - errors:         string[] - fatal verification failures
 *   - warnings:       string[] - non-fatal warnings
 *
 * @param {AdmZip}   zip
 * @returns {Object}
 */
function verifyPackageSignature(zip) {
    var result = {
        valid: true, signed: false, code_signed: false,
        publisher_cert: null, oem_verified: false,
        converted: false, source_certificate: null, conversion_source: null,
        errors: [], warnings: []
    };

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

    // Validate HMAC format before comparison
    if (typeof sig.hmac !== 'string' || !/^[a-f0-9]{64}$/.test(sig.hmac)) {
        result.valid = false;
        result.errors.push('signature.json contains a malformed HMAC value.');
        return result;
    }

    // ---- HMAC-SHA256 tamper-detection verification ----
    var storedPayload = JSON.stringify(sig.file_hashes);
    var expectedHmac  = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(storedPayload).digest('hex');
    var expectedBuf = Buffer.from(expectedHmac, 'hex');
    var storedBuf   = Buffer.from(sig.hmac, 'hex');
    if (expectedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(storedBuf, expectedBuf)) {
        result.valid = false;
        result.errors.push('HMAC mismatch - signature.json has been tampered with.');
        return result;
    }

    // ---- File hash verification ----
    var actualHashes = computeZipEntryHashes(zip);
    var sigFiles     = Object.keys(sig.file_hashes);
    var actualFiles  = Object.keys(actualHashes);

    sigFiles.forEach(function (f) {
        if (!actualHashes[f]) {
            result.valid = false;
            result.errors.push('File listed in signature but missing from package: ' + f);
        } else if (actualHashes[f] !== sig.file_hashes[f]) {
            result.valid = false;
            result.errors.push('File hash mismatch (corrupted or modified): ' + f);
        }
    });

    actualFiles.forEach(function (f) {
        if (!sig.file_hashes[f]) {
            result.valid = false;
            result.errors.push('File present in package but not in signature (injected): ' + f);
        }
    });

    // ---- Ed25519 code signing verification (v2.0+) ----
    if (sig.signature_format_version === '2.0' && sig.digital_signature && sig.publisher_certificate) {
        var cert = sig.publisher_certificate;
        var certCheck = validatePublisherCertificate(cert);
        if (!certCheck.valid) {
            result.valid = false;
            certCheck.errors.forEach(function(e) {
                result.errors.push('Publisher certificate error: ' + e);
            });
        } else {
            // Verify the Ed25519 digital signature against the embedded public key
            var sigValid = ed25519Verify(storedPayload, sig.digital_signature, cert.public_key);
            if (sigValid) {
                result.code_signed = true;
                result.publisher_cert = cert;

                // Auto-verify OEM status: publisher matches a known OEM name
                var pubIsOem = isRestrictedAuthor(cert.publisher) ||
                               isRestrictedAuthor(cert.organization);
                result.oem_verified = pubIsOem;
            } else {
                result.valid = false;
                result.errors.push('Ed25519 digital signature verification FAILED - the package has been tampered with or was signed with a different key.');
            }
        }
    } else if (sig.signature_format_version === '2.0-converted') {
        // ---- Converted distribution (created from .exe by companion tool) ----
        // HMAC integrity already verified above. No Ed25519 signature required.
        // Package integrity is confirmed; flag as converted distribution.
        result.converted = true;
        result.conversion_source = sig.conversion_source || null;
        result.source_certificate = sig.source_certificate || null;
    } else if (sig.signature_format_version === '1.0' || !sig.digital_signature) {
        // Legacy HMAC-only signatures are no longer accepted
        result.valid = false;
        result.code_signed = false;
        result.errors.push('Package uses legacy HMAC-only signature (signature_format_version ' +
            (sig.signature_format_version || 'unknown') + '). ' +
            'Only Ed25519 code-signed packages (v2.0) are accepted.');
    }

    return result;
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

/**
 * Whitelist regex for safe names (library names, group names, author names,
 * organization names, folder names).  Only alphanumeric characters, spaces,
 * dashes, and underscores are permitted.
 */
const SAFE_NAME_REGEX = /^[A-Za-z0-9 \-_]+$/;

/**
 * Whitelist regex for author and organization names.  Allows everything
 * SAFE_NAME_REGEX allows plus commas.
 */
const SAFE_AUTHOR_REGEX = /^[A-Za-z0-9 \-_,]+$/;

// ---------------------------------------------------------------------------
// Author / Organization field constraints
// ---------------------------------------------------------------------------
const AUTHOR_MIN_LENGTH = 3;
const AUTHOR_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------
// Restricted Author / Organization Keywords (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Restricted OEM keywords.  The input is normalized (lowercased, all
 * non-alphanumeric characters removed) and tested for whether it
 * **contains** any of these keywords anywhere in the string.
 * Example: "NotHamilton" is blocked because it contains "hamilton".
 */
const RESTRICTED_AUTHOR_KEYWORDS = [
    'hamilton',
    'tecan',
    'thermofisher', 'thermoscientific', 'fisherscientific',
    'danaher',
    'beckmancoulter',
    'roche', 'rochediagnostics',
    'siemens', 'healthineers',
    'inheco',
    'agilent',
    'revvity', 'perkinelmer',
    'biorad',
    'qiagen',
    'hudsonrobotics',
    'sptlabtech',
    'ttplabtech',
    'swisslog',
    'bectondickinson', 'bdbiosciences', 'bdkiestra',
    'labvantage',
    'labware',
    'automata',
    'opentrons',
    'biosero',
    'greenbuttongo',
    'liconic',
    'sony',
    'azenta', 'brooksautomation',
    'slas', 'societyforlaboratoryautomationandscreening',
    'highresbio',
    'moleculardevices', 'moldev',
    'bmglabtech',
    'aurorabiomed',
    'abcontrols',
    'biotek', 'bioteck'
];

/**
 * Check if an author/organization name is restricted.
 * Normalizes the input by lowercasing and stripping all non-alphanumeric
 * characters, then checks whether the result contains any restricted
 * OEM keyword as a substring.
 * @param {string} author
 * @returns {boolean}
 */
function isRestrictedAuthor(author) {
    if (!author) return false;
    var normalized = author.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) return false;
    for (var i = 0; i < RESTRICTED_AUTHOR_KEYWORDS.length; i++) {
        if (normalized.indexOf(RESTRICTED_AUTHOR_KEYWORDS[i]) !== -1) return true;
    }
    return false;
}

/**
 * Return the restricted OEM keyword(s) that matched the given author/org name.
 * Normalizes the same way as isRestrictedAuthor.
 * @param {string} author
 * @returns {string[]} Array of matching keyword(s), empty if none match
 */
function getMatchedRestrictedKeywords(author) {
    if (!author) return [];
    var normalized = author.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) return [];
    var matches = [];
    for (var i = 0; i < RESTRICTED_AUTHOR_KEYWORDS.length; i++) {
        if (normalized.indexOf(RESTRICTED_AUTHOR_KEYWORDS[i]) !== -1) {
            matches.push(RESTRICTED_AUTHOR_KEYWORDS[i]);
        }
    }
    return matches;
}

/**
 * Validate that a code-signing publisher certificate matches a restricted OEM
 * author name.  This prevents bad actors from distributing libraries under OEM
 * names even if they possess the author password - the package must be
 * code-signed AND the certificate holder (publisher or organization) must
 * encompass the OEM keyword that triggered the restriction.
 *
 * Matching is flexible:
 *   - Author "Hamilton" matches cert holder "Hamilton", "The Hamilton Company",
 *     "Hamilton Company", etc.
 *   - Comparison is case-insensitive with non-alphanumeric chars stripped.
 *
 * @param {string}      author        - Package author field
 * @param {string}      organization  - Package organization field
 * @param {Object|null} publisherCert - Publisher certificate from signature.json
 *                                      (must have .publisher and optionally .organization)
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateOemCertificateMatch(author, organization, publisherCert) {
    // Determine which OEM keywords were triggered by the author/org
    var authorKeywords = getMatchedRestrictedKeywords(author);
    var orgKeywords    = getMatchedRestrictedKeywords(organization);
    var allKeywords    = authorKeywords.concat(orgKeywords);
    // De-duplicate
    var seen = {};
    var uniqueKeywords = [];
    for (var i = 0; i < allKeywords.length; i++) {
        if (!seen[allKeywords[i]]) {
            seen[allKeywords[i]] = true;
            uniqueKeywords.push(allKeywords[i]);
        }
    }
    if (uniqueKeywords.length === 0) return { valid: true, error: null }; // not restricted

    // Must be code-signed
    if (!publisherCert) {
        return {
            valid: false,
            error: 'Restricted OEM author requires a code-signed package with a publisher certificate whose holder name matches the OEM identity. This package is not code-signed.'
        };
    }

    // Normalize the certificate holder fields the same way
    var certPublisher = (publisherCert.publisher || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var certOrg       = (publisherCert.organization || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Every triggered OEM keyword must appear in at least one cert holder field
    var unmatched = [];
    for (var j = 0; j < uniqueKeywords.length; j++) {
        var kw = uniqueKeywords[j];
        var found = (certPublisher && certPublisher.indexOf(kw) !== -1) ||
                    (certOrg       && certOrg.indexOf(kw) !== -1);
        if (!found) unmatched.push(kw);
    }

    if (unmatched.length > 0) {
        var certName = publisherCert.publisher || 'Unknown';
        if (publisherCert.organization) certName += ' (' + publisherCert.organization + ')';
        return {
            valid: false,
            error: 'OEM certificate mismatch: the package claims an OEM author/organization containing "' +
                   unmatched.join('", "') + '" but the code-signing certificate belongs to "' +
                   certName + '". Only packages signed by the actual OEM can use this author name.'
        };
    }

    return { valid: true, error: null };
}

// ---------------------------------------------------------------------------
// OEM Author Password
// ---------------------------------------------------------------------------
// The password is stored as a SHA-256 hash to avoid exposing the plaintext
// in source control.  Comparison uses crypto.timingSafeEqual to resist
// timing side-channel analysis.
const OEM_AUTHOR_PASSWORD_HASH = 'bbdc525497de1c19c57767e36b4f01dadcc05348664eea071ac984fd955bc207';

/**
 * Validate a password against the restricted author password hash.
 * Uses SHA-256 hashing and timing-safe comparison.
 * @param {string} password
 * @returns {boolean}
 */
function validateAuthorPassword(password) {
    if (!password || typeof password !== 'string') return false;
    var inputHash  = crypto.createHash('sha256').update(password).digest();
    var storedHash = Buffer.from(OEM_AUTHOR_PASSWORD_HASH, 'hex');
    try {
        return crypto.timingSafeEqual(inputHash, storedHash);
    } catch (_) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Reserved tag keywords
// ---------------------------------------------------------------------------

/**
 * Tags that are reserved for internal/system use and must not be entered by
 * users.  Comparison is case-insensitive.
 * Includes OEM / restricted company keywords to prevent unauthorized tagging.
 */
const RESERVED_TAGS = [
    'system', 'hamilton', 'oem', 'read-only', 'stared', 'starred', 'signed', 'unsigned', 'registered', 'unregistered',
    'tecan', 'thermofisher', 'thermo-fisher', 'thermoscientific', 'thermo-scientific',
    'fisherscientific', 'fisher-scientific', 'danaher', 'beckmancoulter', 'beckman-coulter',
    'roche', 'rochediagnostics', 'roche-diagnostics',
    'siemens', 'healthineers',
    'inheco', 'agilent', 'revvity', 'perkinelmer', 'perkin-elmer',
    'biorad', 'bio-rad', 'qiagen',
    'hudsonrobotics', 'hudson-robotics',
    'sptlabtech', 'spt-labtech', 'ttplabtech', 'ttp-labtech',
    'swisslog',
    'bectondickinson', 'becton-dickinson', 'bdbiosciences', 'bd-biosciences', 'bdkiestra', 'bd-kiestra',
    'labvantage', 'labware',
    'automata', 'opentrons', 'biosero',
    'greenbuttongo', 'green-button-go', 'gbg',
    'liconic', 'sony', 'azenta', 'brooksautomation', 'brooks-automation',
    'slas', 'highresbio', 'highres-bio',
    'moleculardevices', 'molecular-devices', 'moldev',
    'bmglabtech', 'bmg-labtech',
    'aurorabiomed', 'aurora-biomed',
    'abcontrols', 'ab-controls',
    'biotek', 'bioteck'
];

/** Tag policy constraints */
const TAG_MIN_LENGTH = 2;
const TAG_MAX_LENGTH = 24;
const TAG_MAX_COUNT = 12;
const TAG_UNDERSCORE_EXCEPTIONS = ['ml_star'];

/**
 * Check if a tag consists entirely of digits.
 * @param {string} tag
 * @returns {boolean}
 */
function isNumericOnlyTag(tag) {
    return /^\d+$/.test(tag || '');
}

/**
 * Normalize a tag for deduplication by stripping hyphens.
 * E.g. "my-tag" and "mytag" are considered duplicates.
 * @param {string} tag
 * @returns {string}
 */
function canonicalizeTagForDedup(tag) {
    return (tag || '').replace(/-/g, '');
}

/**
 * Map a machine-readable tag block code to a human-readable reason string.
 * @param {string} code - Block code (e.g. 'empty', 'too_short', 'restricted_word')
 * @returns {string} Human-readable reason
 */
function buildTagBlockReason(code) {
    switch (code) {
        case 'empty': return 'empty';
        case 'empty_after_cleanup': return 'empty after removing invalid characters';
        case 'too_short': return 'too short';
        case 'too_long': return 'too long';
        case 'numeric_only': return 'numbers only';
        case 'restricted_word': return 'contains restricted word';
        case 'max_count': return 'exceeds max tag count';
        default: return 'invalid';
    }
}

/**
 * Sanitize a single tag with detailed feedback used by GUI warning/error modals.
 * - spaces are allowed (multiple consecutive spaces are collapsed to one)
 * - invalid characters are removed (not silently rejected)
 * - repeated/edge hyphens are normalized
 * - restricted words are blocked if found anywhere in the final tag
 *
 * @param {string} tag
 * @returns {{ input:string, value:string, adjusted:boolean, adjustments:string[], blocked:boolean, blockCode:string, blockReason:string, restrictedWords:string[] }}
 */
function sanitizeTagDetailed(tag) {
    var input = (typeof tag === 'string') ? tag : '';
    var result = {
        input: input,
        value: '',
        adjusted: false,
        adjustments: [],
        blocked: false,
        blockCode: '',
        blockReason: '',
        restrictedWords: []
    };

    if (typeof tag !== 'string') {
        result.blocked = true;
        result.blockCode = 'empty';
        result.blockReason = buildTagBlockReason('empty');
        return result;
    }

    var normalized = tag.trim().toLowerCase();
    if (!normalized) {
        result.blocked = true;
        result.blockCode = 'empty';
        result.blockReason = buildTagBlockReason('empty');
        return result;
    }

    var collapsedSpaces = normalized.replace(/\s+/g, ' ').trim();
    if (collapsedSpaces !== normalized) {
        result.adjusted = true;
        result.adjustments.push('normalized spaces');
    }

    if (TAG_UNDERSCORE_EXCEPTIONS.indexOf(collapsedSpaces) !== -1) {
        result.value = collapsedSpaces;
        return result;
    }

    var removedChars = collapsedSpaces.match(/[^a-z0-9- ]/g) || [];
    var cleaned = collapsedSpaces.replace(/[^a-z0-9- ]/g, '');
    if (removedChars.length > 0) {
        result.adjusted = true;
        var uniq = [];
        removedChars.forEach(function(ch) { if (uniq.indexOf(ch) === -1) uniq.push(ch); });
        result.adjustments.push('removed invalid characters: ' + uniq.join(' '));
    }

    var collapsed = cleaned.replace(/-+/g, '-');
    if (collapsed !== cleaned) {
        result.adjusted = true;
        result.adjustments.push('collapsed repeated hyphens');
    }

    var trimmedHyphen = collapsed.replace(/^-+|-+$/g, '');
    if (trimmedHyphen !== collapsed) {
        result.adjusted = true;
        result.adjustments.push('trimmed leading/trailing hyphens');
    }

    if (!trimmedHyphen) {
        result.blocked = true;
        result.blockCode = 'empty_after_cleanup';
        result.blockReason = buildTagBlockReason('empty_after_cleanup');
        return result;
    }

    if (trimmedHyphen.length < TAG_MIN_LENGTH) {
        result.blocked = true;
        result.blockCode = 'too_short';
        result.blockReason = buildTagBlockReason('too_short');
        return result;
    }

    if (trimmedHyphen.length > TAG_MAX_LENGTH) {
        result.blocked = true;
        result.blockCode = 'too_long';
        result.blockReason = buildTagBlockReason('too_long');
        return result;
    }

    if (isNumericOnlyTag(trimmedHyphen)) {
        result.blocked = true;
        result.blockCode = 'numeric_only';
        result.blockReason = buildTagBlockReason('numeric_only');
        return result;
    }

    var restrictedMatches = RESERVED_TAGS.filter(function(w) {
        return trimmedHyphen.indexOf(w) !== -1;
    });
    if (restrictedMatches.length > 0) {
        result.blocked = true;
        result.blockCode = 'restricted_word';
        result.blockReason = buildTagBlockReason('restricted_word');
        result.restrictedWords = restrictedMatches;
        return result;
    }

    result.value = trimmedHyphen;
    return result;
}

/**
 * Sanitize a list of tags and return both accepted tags and human-friendly
 * feedback about adjusted and blocked items.
 * @param {string[]} tags
 * @returns {{ tags:string[], adjusted:Array, blocked:Array }}
 */
function sanitizeTagsWithFeedback(tags) {
    if (!Array.isArray(tags)) return { tags: [], adjusted: [], blocked: [] };
    var seen = {};
    var result = [];
    var adjusted = [];
    var blocked = [];

    tags.forEach(function(t) {
        var details = sanitizeTagDetailed(t);
        if (details.adjusted && !details.blocked) {
            adjusted.push({ input: details.input, output: details.value, adjustments: details.adjustments.slice() });
        }
        if (details.blocked) {
            blocked.push({ input: details.input, reason: details.blockReason, restrictedWords: details.restrictedWords || [] });
            return;
        }
        var canonical = canonicalizeTagForDedup(details.value);
        if (canonical && !seen[canonical]) {
            seen[canonical] = true;
            result.push(details.value);
        }
    });

    if (result.length > TAG_MAX_COUNT) {
        for (var i = TAG_MAX_COUNT; i < result.length; i++) {
            blocked.push({ input: result[i], reason: buildTagBlockReason('max_count'), restrictedWords: [] });
        }
        result = result.slice(0, TAG_MAX_COUNT);
    }

    return { tags: result, adjusted: adjusted, blocked: blocked };
}

/**
 * Group names that are reserved for built-in/system groups and cannot be
 * used when creating or editing custom groups.  Comparison is case-insensitive.
 */
const RESERVED_GROUP_NAMES = [
    'starred', 'oem', 'hamilton', 'system', 'signed', 'unsigned', 'registered', 'unregistered',
    'all', 'recent', 'import', 'export', 'history'
];

/**
 * Check whether a group name matches a reserved keyword (case-insensitive).
 * @param {string} name
 * @returns {boolean}
 */
function isReservedGroupName(name) {
    if (!name || typeof name !== 'string') return false;
    return RESERVED_GROUP_NAMES.indexOf(name.trim().toLowerCase()) !== -1;
}

/**
 * Check whether a single tag string matches a reserved keyword
 * (case-insensitive).
 *
 * @param {string} tag
 * @returns {boolean}
 */
function isReservedTag(tag) {
    if (!tag || typeof tag !== 'string') return false;
    var lower = tag.trim().toLowerCase();
    return RESERVED_TAGS.indexOf(lower) !== -1;
}

/**
 * Filter an array of tag strings, removing any that match reserved keywords.
 * Returns an object with the cleaned array and the list of removed tags.
 *
 * @param {string[]} tags
 * @returns {{ filtered: string[], removed: string[] }}
 */
function filterReservedTags(tags) {
    if (!Array.isArray(tags)) return { filtered: [], removed: [] };
    var filtered = [];
    var removed  = [];
    tags.forEach(function (t) {
        if (isReservedTag(t)) {
            removed.push(t);
        } else {
            filtered.push(t);
        }
    });
    return { filtered: filtered, removed: removed };
}

/**
 * Sanitize a single tag string:
 *  - trim whitespace
 *  - lowercase
 *  - collapse multiple spaces to one (spaces are allowed)
 *
 * @param {string} tag
 * @returns {string}
 */
function sanitizeTag(tag) {
    return sanitizeTagDetailed(tag).value;
}

/**
 * Sanitize an array of tag strings: trim, lowercase, collapse spaces,
 * and remove empty / duplicate entries.
 *
 * @param {string[]} tags
 * @returns {string[]}
 */
function sanitizeTags(tags) {
    return sanitizeTagsWithFeedback(tags).tags;
}

// ---------------------------------------------------------------------------
// GitHub Repository URL validation
// ---------------------------------------------------------------------------

/**
 * Reserved top-level path segments on GitHub that are NOT user/owner names.
 * If the first path segment (case-insensitive) is one of these, the URL
 * cannot be a valid /{owner}/{repo} URL.
 */
const GITHUB_RESERVED_TOPLEVEL = new Set([
    'settings', 'organizations', 'orgs', 'users', 'sessions', 'login',
    'logout', 'join', 'pricing', 'features', 'marketplace', 'topics',
    'explore', 'trending', 'collections', 'events', 'sponsors', 'security',
    'site', 'about', 'contact', 'customer-stories', 'readme', 'codespaces',
    'copilot', 'enterprises', 'enterprise', 'account', 'notifications',
    'inbox', 'watch', 'pulls', 'issues', 'search', 'apps', 'new', 'gist',
    'gists', 'blog', 'discussions', 'actions', 'support'
]);

/**
 * Non-repo path prefixes that are invalid anywhere before we have identified
 * /{owner}/{repo}.  Each is checked as a case-insensitive prefix of the path.
 */
const GITHUB_NONREPO_PREFIXES = [
    '/settings/', '/login/', '/logout/', '/sessions/', '/account/',
    '/organizations/', '/orgs/', '/users/', '/search/', '/marketplace/',
    '/topics/', '/explore/', '/trending/'
];

/**
 * If the third path segment (after /{owner}/{repo}) is one of these, the
 * URL is considered NOT a repo-root context.
 */
const GITHUB_NONREPO_THIRD_SEGMENTS = new Set([
    'settings', 'organizations', 'users', 'search', 'marketplace'
]);

/**
 * Valid sub-routes under /{owner}/{repo}/ that confirm we are viewing a
 * repository page.
 */
const GITHUB_REPO_ROUTES = new Set([
    'issues', 'pull', 'pulls', 'wiki', 'projects', 'actions', 'security',
    'insights', 'settings', 'branches', 'tags', 'releases', 'commits',
    'commit', 'compare', 'graphs', 'network', 'stargazers', 'watchers',
    'forks', 'contributors', 'discussions', 'blob', 'tree', 'raw'
]);

/**
 * Validate that a string is a plausible GitHub repository URL.
 *
 * Returns an object `{ valid: boolean, reason?: string }`.
 *
 * @param {string} url  The candidate URL string.
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateGitHubRepoUrl(url) {
    if (typeof url !== 'string' || !url.trim()) {
        return { valid: false, reason: 'URL is empty.' };
    }
    url = url.trim();

    // --- scheme check ---
    var parsed;
    try { parsed = new URL(url); } catch (_) {
        return { valid: false, reason: 'Not a valid URL.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, reason: 'URL scheme must be http or https.' };
    }

    // --- hostname ---
    if (!parsed.hostname) {
        return { valid: false, reason: 'URL has no hostname.' };
    }

    // --- must have a path with content ---
    var rawPath = parsed.pathname || '/';

    // --- reject fragment-only or query-only without meaningful path ---
    // (parsed.pathname is always at least "/" for valid URLs)

    // strip trailing slash for segment splitting, but keep root
    var trimmedPath = rawPath.replace(/\/+$/, '') || '/';

    // split into segments (first element is '' before the leading /)
    var segments = trimmedPath.split('/');
    // segments[0] is always '' (before leading /); real segments start at [1]
    var realSegments = segments.slice(1).filter(function(s) { return s !== ''; });

    if (realSegments.length < 2) {
        return { valid: false, reason: 'URL must include at least /{owner}/{repo}.' };
    }

    var owner = realSegments[0];
    var repo  = realSegments[1];

    // --- reject if either segment has spaces or URL-encoded control chars ---
    // %20 = space, %0x = C0 control chars, %1x = more control chars, %7F = DEL
    var controlCharRe = /\s|%20|%0[0-9a-fA-F]|%1[0-9a-fA-F]|%7[fF]/;
    if (controlCharRe.test(owner)) {
        return { valid: false, reason: 'Owner segment contains spaces or control characters.' };
    }
    if (controlCharRe.test(repo)) {
        return { valid: false, reason: 'Repo segment contains spaces or control characters.' };
    }

    // --- reject "@" in candidate owner/repo (prevents email-like tokens) ---
    if (owner.indexOf('@') !== -1) {
        return { valid: false, reason: 'Owner segment must not contain "@".' };
    }
    if (repo.indexOf('@') !== -1) {
        return { valid: false, reason: 'Repo segment must not contain "@".' };
    }

    // --- owner dot rules ---
    if (owner.charAt(0) === '.' || owner.charAt(owner.length - 1) === '.') {
        return { valid: false, reason: 'Owner segment must not start or end with a dot.' };
    }
    if (owner.indexOf('..') !== -1) {
        return { valid: false, reason: 'Owner segment must not contain consecutive dots.' };
    }

    // --- repo after stripping trailing .git ---
    var repoStripped = repo.replace(/\.git$/i, '');
    if (!repoStripped) {
        return { valid: false, reason: 'Repo segment is empty after removing trailing ".git".' };
    }

    // --- reject if first segment is a reserved top-level route ---
    if (GITHUB_RESERVED_TOPLEVEL.has(owner.toLowerCase())) {
        return { valid: false, reason: '"' + owner + '" is a reserved GitHub route, not a repository owner.' };
    }

    // --- reject if repo segment is also a reserved word ---
    if (GITHUB_RESERVED_TOPLEVEL.has(repo.toLowerCase())) {
        return { valid: false, reason: '"' + repo + '" is a reserved GitHub route, not a repository name.' };
    }

    // --- reject known non-repo prefix patterns (case-insensitive) ---
    var lowerPath = rawPath.toLowerCase();
    for (var i = 0; i < GITHUB_NONREPO_PREFIXES.length; i++) {
        if (lowerPath === GITHUB_NONREPO_PREFIXES[i].slice(0, -1) || lowerPath.indexOf(GITHUB_NONREPO_PREFIXES[i]) === 0) {
            return { valid: false, reason: 'URL matches a reserved non-repository path.' };
        }
    }

    // --- exactly /{owner}/{repo} or /{owner}/{repo}/ → accept ---
    if (realSegments.length === 2) {
        return { valid: true };
    }

    // --- /{owner}/{repo}.git → accept (already length 2 handled above,
    //     but /{owner}/{repo}.git/ would also be length 2 after trim) ---

    // --- third segment checks ---
    var third = realSegments[2].toLowerCase();

    // if third segment is a known repo-scoped route → accept
    if (GITHUB_REPO_ROUTES.has(third)) {
        return { valid: true };
    }

    // if third segment indicates a non-repo context → reject
    if (GITHUB_NONREPO_THIRD_SEGMENTS.has(third)) {
        return { valid: false, reason: 'URL path after /{owner}/{repo} indicates a non-repository page.' };
    }

    // Otherwise still accept - the first two segments look like owner/repo
    // and the rest could be a deep-link into the repo.
    return { valid: true };
}

// ---------------------------------------------------------------------------
// Application version helper
// ---------------------------------------------------------------------------

/**
 * Read the application version from package.json.
 * Works in both NW.js (GUI) and plain Node.js (CLI) contexts.
 * @returns {string} Version string e.g. "1.8.6", or "" on failure.
 */
function getAppVersion() {
    try {
        // NW.js context
        if (typeof nw !== 'undefined' && nw.App && nw.App.manifest && nw.App.manifest.version) {
            return nw.App.manifest.version;
        }
    } catch (_) {}
    try {
        var pkgPath = path.join(__dirname, '..', 'package.json');
        var pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkgData.version || '';
    } catch (_) {}
    return '';
}

/**
 * Get a concise Windows version string (e.g. "Windows_NT 10.0.19045 (x64)").
 * Centralised here to eliminate duplication between CLI and GUI.
 *
 * @returns {string}
 */
function getWindowsVersion() {
    try {
        return os.type() + ' ' + os.release() + ' (' + os.arch() + ')';
    } catch (_) {
        return 'Unknown';
    }
}

/**
 * Build a lineage event record that captures the environmental context
 * at the time of a packaging or export/repackage operation.
 *
 * @param {string} eventType    - 'created' | 'exported' | 'repackaged'
 * @param {object} opts         - { username, hostname, venusVersion }
 * @returns {object} A lineage event record
 */
function buildLineageEvent(eventType, opts) {
    if (VALID_LINEAGE_EVENTS.indexOf(eventType) === -1) {
        throw new Error('Invalid lineage event type: "' + eventType + '". Must be one of: ' + VALID_LINEAGE_EVENTS.join(', '));
    }
    opts = opts || {};
    var evt = {
        event:           eventType,
        timestamp:       new Date().toISOString(),
        app_version:     getAppVersion(),
        format_version:  FORMAT_VERSION,
        username:        opts.username  || '',
        hostname:        opts.hostname  || '',
        windows_version: getWindowsVersion(),
        venus_version:   opts.venusVersion   || ''
    };
    return evt;
}

// ---------------------------------------------------------------------------
// HSL Parser Functions
// ---------------------------------------------------------------------------

/**
 * Strip string literals and comments from HSL source so that keyword
 * searches (namespace, function) are not confused by content inside strings/comments.
 * @param {string} text - raw HSL source
 * @returns {string} sanitized text with strings/comments replaced by spaces
 */
function sanitizeHslForParsing(text) {
    const chars = text.split('');
    let i = 0;
    while (i < chars.length) {
        const ch = chars[i];
        const next = (i + 1 < chars.length) ? chars[i + 1] : '';

        // String literal
        if (ch === '"') {
            chars[i] = ' ';
            let j = i + 1;
            while (j < chars.length) {
                const c = chars[j];
                if (c === '\\' && j + 1 < chars.length) {
                    chars[j] = ' '; chars[j + 1] = ' '; j += 2; continue;
                }
                chars[j] = (c === '\n' || c === '\r') ? c : ' ';
                if (c === '"') { j++; break; }
                j++;
            }
            i = j; continue;
        }
        // Line comment
        if (ch === '/' && next === '/') {
            chars[i] = ' '; chars[i + 1] = ' '; i += 2;
            while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i++; }
            continue;
        }
        // Block comment
        if (ch === '/' && next === '*') {
            chars[i] = ' '; chars[i + 1] = ' '; i += 2;
            while (i < chars.length) {
                if (chars[i] === '*' && i + 1 < chars.length && chars[i + 1] === '/') {
                    chars[i] = ' '; chars[i + 1] = ' '; i += 2; break;
                }
                chars[i] = (chars[i] === '\n' || chars[i] === '\r') ? chars[i] : ' ';
                i++;
            }
            continue;
        }
        i++;
    }
    return chars.join('');
}

/**
 * Split a comma-separated parameter list respecting nested parentheses.
 * @param {string} paramList
 * @returns {string[]}
 */
function splitHslArgs(paramList) {
    const parts = [];
    let current = '';
    let depth = 0;
    for (let ci = 0; ci < paramList.length; ci++) {
        const c = paramList[ci];
        if (c === '(') { depth++; current += c; continue; }
        if (c === ')') { depth = Math.max(0, depth - 1); current += c; continue; }
        if (c === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
        current += c;
    }
    if (current.trim().length > 0) parts.push(current.trim());
    return parts;
}

/**
 * Parse a single HSL parameter string like "variable& name[]" into a descriptor.
 * @param {string} param
 * @returns {{type: string, name: string, byRef: boolean, array: boolean}}
 */
function parseHslParameter(param) {
    const trimmed = param.trim();
    const rawNoDefault = trimmed.indexOf('=') !== -1 ? trimmed.slice(0, trimmed.indexOf('=')).trim() : trimmed;
    const isArray = /\[\]\s*$/.test(rawNoDefault);
    const noArray = rawNoDefault.replace(/\[\]\s*$/, '').trim();
    const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(noArray);
    const nameText = nameMatch ? nameMatch[1] : noArray;
    let beforeName = nameMatch ? noArray.slice(0, nameMatch.index).trim() : '';
    const isByRef = beforeName.indexOf('&') !== -1;
    beforeName = beforeName.replace(/&/g, '').trim();
    return {
        type: beforeName || 'variable',
        name: nameText,
        byRef: isByRef,
        array: isArray
    };
}

/**
 * Extract the doc-comment block immediately above a function definition.
 * @param {string[]} originalLines - source lines
 * @param {number} functionStartLine - 0-based line index
 * @returns {string}
 */
function extractHslDocComment(originalLines, functionStartLine) {
    let i = functionStartLine - 1;
    while (i >= 0 && originalLines[i].trim() === '') i--;
    if (i < 0) return '';

    const line = originalLines[i].trim();
    // Single-line comment block
    if (line.indexOf('//') === 0) {
        const buf = [];
        while (i >= 0 && originalLines[i].trim().indexOf('//') === 0) {
            buf.push(originalLines[i].trim().replace(/^\/\/\s?/, ''));
            i--;
        }
        buf.reverse();
        return buf.join('\n').trim();
    }
    // Block comment
    if (line.indexOf('*/') !== -1) {
        const buf = [];
        while (i >= 0) {
            buf.push(originalLines[i]);
            if (originalLines[i].indexOf('/*') !== -1) break;
            i--;
        }
        buf.reverse();
        return buf.join('\n')
            .replace(/^\s*\/\*+/, '')
            .replace(/\*+\/\s*$/, '')
            .split(/\r?\n/)
            .map(function(s) { return s.replace(/^\s*\*\s?/, ''); })
            .join('\n')
            .trim();
    }
    return '';
}

/**
 * Parse all public functions from an HSL source string.
 * Returns an array of { name, qualifiedName, params, returnType, doc, isPrivate, file }.
 * @param {string} text - HSL source
 * @param {string} [fileName] - source filename for labelling
 * @returns {Array<Object>}
 */
function parseHslFunctions(text, fileName) {
    const sanitized = sanitizeHslForParsing(text);
    const originalLines = text.split(/\r?\n/);
    const cleanLines = sanitized.split(/\r?\n/);
    const functions = [];

    const namespaceStack = [];
    let braceDepth = 0;
    let pendingNamespace = null;

    let collectingFunction = false;
    let functionStartLine = -1;
    let functionHeaderParts = [];

    for (let lineIndex = 0; lineIndex < cleanLines.length; lineIndex++) {
        const cleanLine = cleanLines[lineIndex];
        const originalLine = originalLines[lineIndex] || '';

        if (!collectingFunction) {
            const nsMatch = /^\s*(?:(?:private|public|static|global|const|synchronized)\s+)*namespace\s+([A-Za-z_]\w*)\b/.exec(cleanLine);
            if (nsMatch) {
                pendingNamespace = nsMatch[1];
            }
            if (/^\s*(?:(?:private|public|static|global|const|synchronized)\s+)*function\b/.test(cleanLine)) {
                collectingFunction = true;
                functionStartLine = lineIndex;
                functionHeaderParts = [originalLine];
            }
        } else {
            functionHeaderParts.push(originalLine);
        }

        if (collectingFunction) {
            const joinedClean = sanitizeHslForParsing(functionHeaderParts.join('\n'));
            const openCount  = (joinedClean.match(/\(/g) || []).length;
            const closeCount = (joinedClean.match(/\)/g) || []).length;
            const parenDelta = openCount - closeCount;
            const hasTerminator = /[;{]/.test(joinedClean);
            if (parenDelta <= 0 && hasTerminator) {
                const joinedOriginal = functionHeaderParts.join('\n');
                const fnMatch = /^\s*((?:(?:private|public|static|global|const|synchronized)\s+)*)function\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*([A-Za-z_]\w*)\s*(?:;|\{)/m.exec(joinedOriginal);
                if (fnMatch) {
                    const modifiers = fnMatch[1] || '';
                    const name = fnMatch[2];
                    const paramsRaw = fnMatch[3] || '';
                    const returnType = fnMatch[4] || 'variable';
                    const isPrivate = /\bprivate\b/.test(modifiers);

                    const params = splitHslArgs(paramsRaw)
                        .filter(function(p) { return p.length > 0; })
                        .map(parseHslParameter);

                    const nsPrefix = namespaceStack.map(function(n) { return n.name; }).join('::');
                    const qualifiedName = nsPrefix.length > 0 ? nsPrefix + '::' + name : name;
                    const doc = extractHslDocComment(originalLines, functionStartLine);

                    functions.push({
                        name:          name,
                        qualifiedName: qualifiedName,
                        params:        params,
                        returnType:    returnType,
                        doc:           doc,
                        isPrivate:     isPrivate,
                        file:          fileName || ''
                    });
                }
                collectingFunction = false;
                functionStartLine = -1;
                functionHeaderParts = [];
            }
        }

        // Track brace depth for namespace scoping
        for (let ci = 0; ci < cleanLine.length; ci++) {
            const ch = cleanLine[ci];
            if (ch === '{') {
                braceDepth++;
                if (pendingNamespace) {
                    namespaceStack.push({ name: pendingNamespace, depth: braceDepth });
                    pendingNamespace = null;
                }
            } else if (ch === '}') {
                while (namespaceStack.length > 0 && namespaceStack[namespaceStack.length - 1].depth >= braceDepth) {
                    namespaceStack.pop();
                }
                braceDepth = Math.max(0, braceDepth - 1);
            }
        }
    }
    return functions;
}

/**
 * Extract public (non-private) functions from HSL files.
 * @param {string[]} libFiles - filenames
 * @param {string} libBasePath - directory containing the files
 * @returns {Array<Object>} array of public function descriptors
 */
function extractPublicFunctions(libFiles, libBasePath) {
    const allFunctions = [];
    (libFiles || []).forEach(function(fname) {
        const ext = path.extname(fname).toLowerCase();
        if (ext !== '.hsl') return;
        const fullPath = path.join(libBasePath, fname);
        try {
            const text = fs.readFileSync(fullPath, 'utf8');
            const fns = parseHslFunctions(text, fname);
            fns.forEach(function(fn) {
                if (!fn.isPrivate) {
                    allFunctions.push({
                        name:          fn.name,
                        qualifiedName: fn.qualifiedName,
                        params:        fn.params,
                        returnType:    fn.returnType,
                        doc:           fn.doc,
                        file:          fn.file
                    });
                }
            });
        } catch (_) { /* skip unreadable files */ }
    });
    return allFunctions;
}

/**
 * Extract #include directives from HSL source text.
 * @param {string} text - HSL source code
 * @returns {string[]} array of raw include target strings
 */
function extractHslIncludes(text) {
    const includes = [];
    const pattern = /^\s*#include\s+"([^"]+)"/gm;
    let m;
    while ((m = pattern.exec(text)) !== null) {
        includes.push(m[1].trim());
    }
    return includes;
}

// ---------------------------------------------------------------------------
// .libmgr marker files — per-directory library fingerprints
// ---------------------------------------------------------------------------

/**
 * Marker filename placed in library install directories.
 * Analogous to .git — a hidden file that tracks which managed libraries
 * exist in (or below) a directory, together with their file hashes so
 * that the application can verify integrity, detect orphans, and
 * recover from reinstalls without a database.
 */
const LIBMGR_MARKER_FILENAME = '.libmgr';

/**
 * Build a marker entry object for a single library.
 *
 * @param {Object}  opts
 * @param {string}  opts.library_name
 * @param {string}  opts.version
 * @param {string}  opts.author
 * @param {string}  [opts.organization]
 * @param {Object}  opts.file_hashes     - { relative_filename: sha256hex }
 * @param {string}  opts.installed_date  - ISO-8601
 * @param {string}  [opts.installed_by]
 * @param {string}  [opts.source_package]
 * @returns {Object} marker entry
 */
function buildMarkerEntry(opts) {
    return {
        library_name:   opts.library_name   || '',
        version:        opts.version        || '',
        author:         opts.author         || '',
        organization:   opts.organization   || '',
        file_hashes:    opts.file_hashes    || {},
        installed_date: opts.installed_date || new Date().toISOString(),
        installed_by:   opts.installed_by   || '',
        source_package: opts.source_package || '',
        marker_version: '1.0'
    };
}

/**
 * Read and parse a .libmgr marker file.  Returns the parsed object
 * or an empty object if the file doesn't exist or is malformed.
 *
 * @param {string} markerPath - Full path to the .libmgr file
 * @returns {Object} { _marker_version, libraries: { libName: entry, ... } }
 */
function readMarkerFile(markerPath) {
    try {
        if (!fs.existsSync(markerPath)) return { _marker_version: '1.0', libraries: {} };
        var raw = fs.readFileSync(markerPath, 'utf8');
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.libraries) {
            return { _marker_version: '1.0', libraries: {} };
        }
        return parsed;
    } catch (_) {
        return { _marker_version: '1.0', libraries: {} };
    }
}

/**
 * Write (or update) the .libmgr marker in a library's install directory.
 *
 * One marker file per directory: if multiple libraries share the same
 * directory, each gets a keyed entry inside the same file.
 *
 * @param {string}  libInstallDir   - The library's root install directory
 * @param {string}  libraryName     - Unique library name (key in marker)
 * @param {Object}  entry           - Entry from buildMarkerEntry()
 */
function writeMarkerFile(libInstallDir, libraryName, entry) {
    try {
        if (!libInstallDir || !libraryName) return;
        if (!fs.existsSync(libInstallDir)) return;

        var markerPath = path.join(libInstallDir, LIBMGR_MARKER_FILENAME);
        var marker = readMarkerFile(markerPath);

        marker._marker_version = '1.0';
        marker.libraries[libraryName] = entry;
        marker._updated = new Date().toISOString();

        fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');

        // Mark file as hidden on Windows
        try {
            if (process.platform === 'win32') {
                require('child_process').execFileSync('attrib', ['+H', markerPath], { stdio: 'ignore', timeout: 5000 });
            }
        } catch (_) { /* non-critical */ }
    } catch (_) { /* non-critical — marker is supplementary */ }
}

/**
 * Remove a single library's entry from the .libmgr marker in a directory.
 * If the marker becomes empty (no libraries), the file is deleted.
 *
 * @param {string} libInstallDir - The library's root install directory
 * @param {string} libraryName  - Library name to remove
 */
function removeMarkerEntry(libInstallDir, libraryName) {
    try {
        if (!libInstallDir || !libraryName) return;
        var markerPath = path.join(libInstallDir, LIBMGR_MARKER_FILENAME);
        if (!fs.existsSync(markerPath)) return;

        var marker = readMarkerFile(markerPath);
        delete marker.libraries[libraryName];

        if (Object.keys(marker.libraries).length === 0) {
            fs.unlinkSync(markerPath);
        } else {
            marker._updated = new Date().toISOString();
            fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
            // Re-apply hidden attribute after rewrite
            try {
                if (process.platform === 'win32') {
                    require('child_process').execFileSync('attrib', ['+H', markerPath], { stdio: 'ignore', timeout: 5000 });
                }
            } catch (_) { /* non-critical */ }
        }
    } catch (_) { /* non-critical */ }
}

/**
 * Verify a library's files against its .libmgr marker entry.
 *
 * @param {string} libInstallDir - Library root install directory
 * @param {string} libraryName  - Library name to verify
 * @returns {Object} { found, valid, missing[], tampered[], errors[], entry }
 */
function verifyMarkerIntegrity(libInstallDir, libraryName) {
    var result = { found: false, valid: true, missing: [], tampered: [], errors: [], entry: null };
    try {
        if (!libInstallDir || !libraryName) { result.valid = false; return result; }
        var markerPath = path.join(libInstallDir, LIBMGR_MARKER_FILENAME);
        var marker = readMarkerFile(markerPath);
        var entry = marker.libraries[libraryName];
        if (!entry) { result.valid = false; return result; }

        result.found = true;
        result.entry = entry;
        var storedHashes = entry.file_hashes || {};

        Object.keys(storedHashes).forEach(function (fname) {
            var fullPath = path.join(libInstallDir, fname);
            if (!fs.existsSync(fullPath)) {
                result.missing.push(fname);
                result.valid = false;
                return;
            }
            var currentHash = computeFileHash(fullPath);
            if (currentHash && currentHash !== storedHashes[fname]) {
                result.tampered.push(fname);
                result.valid = false;
            }
        });
    } catch (e) {
        result.valid = false;
        result.errors.push(e.message);
    }
    return result;
}

/**
 * Scan a directory (non-recursively) for a .libmgr marker and return
 * all library entries found in it.
 *
 * @param {string} dirPath - Directory to scan
 * @returns {Object} { dirPath, libraries: { name: entry } } or null
 */
function scanDirectoryMarker(dirPath) {
    try {
        var markerPath = path.join(dirPath, LIBMGR_MARKER_FILENAME);
        if (!fs.existsSync(markerPath)) return null;
        var marker = readMarkerFile(markerPath);
        if (Object.keys(marker.libraries).length === 0) return null;
        return { dirPath: dirPath, libraries: marker.libraries };
    } catch (_) {
        return null;
    }
}

/**
 * Write or update .libmgr marker for a library after install/import.
 * Convenience wrapper that builds the entry and writes it.
 * Should be called for every non-system library install.
 *
 * @param {Object} dbRecord - The installed_libs DB record (after save)
 */
function updateMarkerForLibrary(dbRecord) {
    if (!dbRecord || !dbRecord.lib_install_path || !dbRecord.library_name) return;

    var entry = buildMarkerEntry({
        library_name:   dbRecord.library_name,
        version:        dbRecord.version,
        author:         dbRecord.author,
        organization:   dbRecord.organization,
        file_hashes:    dbRecord.file_hashes,
        installed_date: dbRecord.installed_date,
        installed_by:   dbRecord.installed_by,
        source_package: dbRecord.source_package
    });

    writeMarkerFile(dbRecord.lib_install_path, dbRecord.library_name, entry);
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------
/**
 * Compare two semver-like version strings.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
    var partsA = (a || '0').replace(/^v/i, '').split('.').map(Number);
    var partsB = (b || '0').replace(/^v/i, '').split('.').map(Number);
    var maxLen = Math.max(partsA.length, partsB.length);
    for (var i = 0; i < maxLen; i++) {
        var numA = partsA[i] || 0;
        var numB = partsB[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
    // Constants
    FORMAT_VERSION:     FORMAT_VERSION,
    VALID_LINEAGE_EVENTS: VALID_LINEAGE_EVENTS,
    KNOWN_MANIFEST_KEYS:  KNOWN_MANIFEST_KEYS,
    KNOWN_LIB_DB_KEYS:    KNOWN_LIB_DB_KEYS,
    INSTALLER_STORE_DIRNAME: INSTALLER_STORE_DIRNAME,
    HASH_EXTENSIONS:    HASH_EXTENSIONS,
    HSL_METADATA_EXTS:  HSL_METADATA_EXTS,
    IMAGE_MIME_MAP:     IMAGE_MIME_MAP,
    VALID_IMAGE_MIMES: VALID_IMAGE_MIMES,

    AUTHOR_MIN_LENGTH:  AUTHOR_MIN_LENGTH,
    AUTHOR_MAX_LENGTH:  AUTHOR_MAX_LENGTH,
    RESTRICTED_AUTHOR_KEYWORDS: RESTRICTED_AUTHOR_KEYWORDS,
    isRestrictedAuthor: isRestrictedAuthor,
    getMatchedRestrictedKeywords: getMatchedRestrictedKeywords,
    validateOemCertificateMatch: validateOemCertificateMatch,

    validateAuthorPassword: validateAuthorPassword,
    RESERVED_TAGS:      RESERVED_TAGS,
    RESERVED_GROUP_NAMES: RESERVED_GROUP_NAMES,
    TAG_MIN_LENGTH:     TAG_MIN_LENGTH,
    TAG_MAX_LENGTH:     TAG_MAX_LENGTH,
    TAG_MAX_COUNT:      TAG_MAX_COUNT,

    // Container format constants
    CONTAINER_MAGIC_PKG:    CONTAINER_MAGIC_PKG,
    CONTAINER_MAGIC_ARC:    CONTAINER_MAGIC_ARC,
    CONTAINER_HEADER_SIZE:  CONTAINER_HEADER_SIZE,

    // HTML escaping
    escapeHtml:         escapeHtml,

    // Filesystem safety
    safeZipExtractPath:         safeZipExtractPath,
    isValidLibraryName:         isValidLibraryName,
    sanitizeManifestPath:       sanitizeManifestPath,
    validateManifestPaths:      validateManifestPaths,
    sanitizeManifestFilePaths:  sanitizeManifestFilePaths,

    // File extension restrictions
    RESTRICTED_FILE_EXTENSIONS: RESTRICTED_FILE_EXTENSIONS,
    isRestrictedFileExtension:  isRestrictedFileExtension,
    validateManifestFileExtensions: validateManifestFileExtensions,

    // Tag validation
    isReservedTag:          isReservedTag,
    filterReservedTags:     filterReservedTags,
    sanitizeTag:            sanitizeTag,
    sanitizeTags:           sanitizeTags,
    sanitizeTagDetailed:    sanitizeTagDetailed,
    sanitizeTagsWithFeedback: sanitizeTagsWithFeedback,
    isReservedGroupName:    isReservedGroupName,
    isValidGroupName:       isValidGroupName,
    isValidAuthorName:      isValidAuthorName,
    isValidOrganizationName: isValidOrganizationName,
    isValidSubdirPath:      isValidSubdirPath,
    SAFE_NAME_REGEX:        SAFE_NAME_REGEX,

    // Integrity hashing
    computeFileHash:        computeFileHash,
    computeLibraryHashes:   computeLibraryHashes,
    parseHslMetadataFooter: parseHslMetadataFooter,

    // Package signing
    computeZipEntryHashes:    computeZipEntryHashes,
    signPackageZipWithCert:   signPackageZipWithCert,
    verifyPackageSignature:   verifyPackageSignature,

    // Code signing certificates
    CERT_FORMAT_VERSION:          CERT_FORMAT_VERSION,
    generateSigningKeyPair:       generateSigningKeyPair,
    computeKeyFingerprint:        computeKeyFingerprint,
    buildPublisherCertificate:    buildPublisherCertificate,
    ed25519Sign:                  ed25519Sign,
    ed25519Verify:                ed25519Verify,
    validatePublisherCertificate: validatePublisherCertificate,

    // Binary container
    packContainer:            packContainer,
    unpackContainer:          unpackContainer,

    // GitHub URL validation
    validateGitHubRepoUrl:    validateGitHubRepoUrl,

    // Version & lineage
    getAppVersion:            getAppVersion,
    getWindowsVersion:        getWindowsVersion,
    buildLineageEvent:        buildLineageEvent,

    // HSL parser
    sanitizeHslForParsing:    sanitizeHslForParsing,
    splitHslArgs:             splitHslArgs,
    parseHslParameter:        parseHslParameter,
    extractHslDocComment:     extractHslDocComment,
    parseHslFunctions:        parseHslFunctions,
    extractPublicFunctions:   extractPublicFunctions,
    extractHslIncludes:       extractHslIncludes,

    // .libmgr marker files
    LIBMGR_MARKER_FILENAME:   LIBMGR_MARKER_FILENAME,
    buildMarkerEntry:         buildMarkerEntry,
    readMarkerFile:           readMarkerFile,
    writeMarkerFile:          writeMarkerFile,
    removeMarkerEntry:        removeMarkerEntry,
    verifyMarkerIntegrity:    verifyMarkerIntegrity,
    scanDirectoryMarker:      scanDirectoryMarker,
    updateMarkerForLibrary:   updateMarkerForLibrary,

    // Version comparison
    compareVersions:          compareVersions
};
