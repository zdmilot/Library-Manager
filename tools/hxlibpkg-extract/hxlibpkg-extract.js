#!/usr/bin/env node
/**
 * hxlibpkg-extract  –  Portable extraction tool for .hxlibpkg packages
 *
 * Unpacks a Hamilton VENUS Library Manager package (.hxlibpkg) without
 * requiring the full Library Manager application.  Extracts library files,
 * demo methods, and embedded installers to a target directory.
 *
 * Usage:
 *   node hxlibpkg-extract.js <package.hxlibpkg> [--out <dir>] [--list] [--manifest]
 *
 * Options:
 *   --out <dir>   Output directory (default: ./<library_name>)
 *   --list        List package contents without extracting
 *   --manifest    Print manifest.json and exit
 *
 * Requirements: Node.js 12+ and adm-zip (npm install adm-zip)
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');

// ---------------------------------------------------------------------------
// Binary container constants (must match lib/shared.js)
// ---------------------------------------------------------------------------
var PKG_SIGNING_KEY = 'VenusLibMgr::PackageIntegrity::a7e3f9d1c6b2';

var CONTAINER_MAGIC_PKG = Buffer.from([0x48, 0x58, 0x4C, 0x50, 0x4B, 0x47, 0x01, 0x00]);
var CONTAINER_MAGIC_ARC = Buffer.from([0x48, 0x58, 0x4C, 0x41, 0x52, 0x43, 0x01, 0x00]);

var CONTAINER_SCRAMBLE_KEY = Buffer.from([
    0x7A, 0x3F, 0xC1, 0xD8, 0x4E, 0x92, 0xB5, 0x16,
    0xA3, 0x0D, 0xE7, 0x68, 0xF4, 0x2C, 0x59, 0x8B,
    0x31, 0xCA, 0x75, 0x0E, 0x96, 0xAF, 0xD2, 0x43,
    0xBC, 0x1A, 0x67, 0xE0, 0x58, 0x84, 0x3B, 0xF9
]);

var CONTAINER_HEADER_SIZE = 48;

// ---------------------------------------------------------------------------
// Container unpacking
// ---------------------------------------------------------------------------
function unpackContainer(containerBuffer, magic) {
    if (!Buffer.isBuffer(containerBuffer) || containerBuffer.length < CONTAINER_HEADER_SIZE) {
        throw new Error('Invalid package: file is too small or not a valid container.');
    }
    if (containerBuffer.compare(magic, 0, magic.length, 0, magic.length) !== 0) {
        throw new Error('Invalid package: unrecognized file format.');
    }
    var payloadLen = containerBuffer.readUInt32LE(12);
    var storedHmac = containerBuffer.slice(16, CONTAINER_HEADER_SIZE);
    if (containerBuffer.length < CONTAINER_HEADER_SIZE + payloadLen) {
        throw new Error('Invalid package: file is truncated or corrupted.');
    }
    var scrambled = containerBuffer.slice(CONTAINER_HEADER_SIZE, CONTAINER_HEADER_SIZE + payloadLen);
    var computedHmac = crypto.createHmac('sha256', PKG_SIGNING_KEY).update(scrambled).digest();
    if (!crypto.timingSafeEqual(storedHmac, computedHmac)) {
        throw new Error('Package integrity check failed: the file has been corrupted or tampered with.');
    }
    var zipBuffer = Buffer.alloc(scrambled.length);
    for (var i = 0; i < scrambled.length; i++) {
        zipBuffer[i] = scrambled[i] ^ CONTAINER_SCRAMBLE_KEY[i % CONTAINER_SCRAMBLE_KEY.length];
    }
    return zipBuffer;
}

// ---------------------------------------------------------------------------
// Path traversal guard
// ---------------------------------------------------------------------------
function safeExtractPath(baseDir, relPath) {
    var resolved = path.resolve(baseDir, relPath);
    var normalBase = path.resolve(baseDir) + path.sep;
    if (!resolved.startsWith(normalBase) && resolved !== path.resolve(baseDir)) {
        return null;
    }
    return resolved;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function printUsage() {
    console.log('Usage: node hxlibpkg-extract.js <package.hxlibpkg> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --out <dir>   Output directory (default: ./<library_name>)');
    console.log('  --list        List package contents without extracting');
    console.log('  --manifest    Print manifest.json and exit');
    console.log('  --help        Show this help message');
}

function main() {
    var args = process.argv.slice(2);
    if (args.length === 0 || args.indexOf('--help') !== -1) {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    var packagePath = null;
    var outDir = null;
    var listOnly = false;
    var manifestOnly = false;

    for (var i = 0; i < args.length; i++) {
        if (args[i] === '--out' && i + 1 < args.length) {
            outDir = args[++i];
        } else if (args[i] === '--list') {
            listOnly = true;
        } else if (args[i] === '--manifest') {
            manifestOnly = true;
        } else if (!packagePath) {
            packagePath = args[i];
        }
    }

    if (!packagePath) {
        console.error('Error: no package file specified.');
        printUsage();
        process.exit(1);
    }

    if (!fs.existsSync(packagePath)) {
        console.error('Error: file not found: ' + packagePath);
        process.exit(1);
    }

    // Try loading adm-zip
    var AdmZip;
    try {
        AdmZip = require('adm-zip');
    } catch(e) {
        // Try loading from the parent Library Manager's node_modules
        try {
            AdmZip = require(path.join(__dirname, '..', '..', 'node_modules', 'adm-zip'));
        } catch(e2) {
            console.error('Error: adm-zip module not found.');
            console.error('Install it with: npm install adm-zip');
            process.exit(1);
        }
    }

    // Detect file type and unpack
    var rawBuffer = fs.readFileSync(packagePath);
    var isArchive = false;
    var zipBuffer;

    try {
        zipBuffer = unpackContainer(rawBuffer, CONTAINER_MAGIC_PKG);
    } catch(e) {
        try {
            zipBuffer = unpackContainer(rawBuffer, CONTAINER_MAGIC_ARC);
            isArchive = true;
        } catch(e2) {
            console.error('Error: ' + e.message);
            process.exit(1);
        }
    }

    if (isArchive) {
        // Archive: extract inner .hxlibpkg files, then extract each one
        var archiveZip = new AdmZip(zipBuffer);
        var archiveEntries = archiveZip.getEntries();
        var pkgEntries = archiveEntries.filter(function(e) {
            return e.entryName.toLowerCase().endsWith('.hxlibpkg');
        });

        if (manifestOnly) {
            // Print archive manifest
            var archManifestEntry = archiveZip.getEntry('manifest.json');
            if (archManifestEntry) {
                console.log(archManifestEntry.getData().toString('utf8'));
            } else {
                console.error('No manifest.json found in archive.');
            }
            process.exit(0);
        }

        console.log('Archive contains ' + pkgEntries.length + ' package(s):');
        pkgEntries.forEach(function(pe) {
            console.log('  ' + pe.entryName);
        });

        if (listOnly) {
            process.exit(0);
        }

        var baseOutDir = outDir || path.basename(packagePath, path.extname(packagePath));

        pkgEntries.forEach(function(pe) {
            var innerBuffer = pe.getData();
            try {
                var innerZipBuffer = unpackContainer(innerBuffer, CONTAINER_MAGIC_PKG);
                var innerZip = new AdmZip(innerZipBuffer);
                var innerManifestEntry = innerZip.getEntry('manifest.json');
                var innerManifest = {};
                if (innerManifestEntry) {
                    innerManifest = JSON.parse(innerManifestEntry.getData().toString('utf8'));
                }
                var libName = innerManifest.library_name || path.basename(pe.entryName, '.hxlibpkg');
                var libOutDir = path.join(baseOutDir, libName.replace(/[<>:"\/\\|?*]/g, '_'));
                extractPackageZip(innerZip, innerManifest, libOutDir);
            } catch(ex) {
                console.error('  Error extracting ' + pe.entryName + ': ' + ex.message);
            }
        });
    } else {
        // Single package
        var zip = new AdmZip(zipBuffer);
        var manifestEntry = zip.getEntry('manifest.json');
        var manifest = {};
        if (manifestEntry) {
            manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        }

        if (manifestOnly) {
            console.log(JSON.stringify(manifest, null, 2));
            process.exit(0);
        }

        if (listOnly) {
            var entries = zip.getEntries();
            console.log('Package: ' + (manifest.library_name || 'Unknown') + ' v' + (manifest.version || '?'));
            console.log(entries.length + ' entries:');
            entries.forEach(function(e) {
                if (!e.isDirectory) {
                    console.log('  ' + e.entryName + '  (' + e.header.size + ' bytes)');
                }
            });
            process.exit(0);
        }

        var libName = manifest.library_name || path.basename(packagePath, path.extname(packagePath));
        var targetDir = outDir || libName.replace(/[<>:"\/\\|?*]/g, '_');
        extractPackageZip(zip, manifest, targetDir);
    }
}

function extractPackageZip(zip, manifest, targetDir) {
    var libName = manifest.library_name || 'Unknown';
    var entries = zip.getEntries();
    var extracted = 0;

    var libDir = path.join(targetDir, 'library');
    var demoDir = path.join(targetDir, 'demo_methods');
    var installerDir = path.join(targetDir, 'installer');
    var iconDir = path.join(targetDir, 'icon');

    entries.forEach(function(entry) {
        if (entry.isDirectory) return;
        if (entry.entryName === 'manifest.json' || entry.entryName === 'signature.json') return;

        var destDir = targetDir;
        var relName = entry.entryName;

        if (entry.entryName.indexOf('library/') === 0) {
            destDir = libDir;
            relName = entry.entryName.substring('library/'.length);
        } else if (entry.entryName.indexOf('demo_methods/') === 0) {
            destDir = demoDir;
            relName = entry.entryName.substring('demo_methods/'.length);
        } else if (entry.entryName.indexOf('installer/') === 0) {
            destDir = installerDir;
            relName = entry.entryName.substring('installer/'.length);
        } else if (entry.entryName.indexOf('icon/') === 0) {
            destDir = iconDir;
            relName = entry.entryName.substring('icon/'.length);
        }

        if (!relName) return;

        var safePath = safeExtractPath(destDir, relName);
        if (!safePath) {
            console.warn('  Skipping unsafe path: ' + entry.entryName);
            return;
        }

        var parentDir = path.dirname(safePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(safePath, entry.getData());
        extracted++;
    });

    // Write manifest.json to output
    var manifestEntry = zip.getEntry('manifest.json');
    if (manifestEntry) {
        var manifestPath = path.join(targetDir, 'manifest.json');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(manifestPath, manifestEntry.getData());
        extracted++;
    }

    console.log('Extracted "' + libName + '" (' + extracted + ' files) -> ' + path.resolve(targetDir));

    if (manifest.installer_executable) {
        console.log('  Installer: ' + manifest.installer_executable);
        if (manifest.installer_info && manifest.installer_info.description) {
            console.log('  Description: ' + manifest.installer_info.description);
        }
    }
}

main();
