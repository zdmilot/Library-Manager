/**
 * updater.js - Auto-update module for Library Manager
 * Checks GitHub releases for new versions and downloads/installs updates.
 * Only operates when the app is installed (detected via Windows registry).
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn, execFile } = require('child_process');
const os = require('os');

// GitHub release API endpoint
const GITHUB_OWNER = 'zdmilot';
const GITHUB_REPO = 'Library-Manager';
const RELEASES_API = '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest';
const API_HOST = 'api.github.com';

// Inno Setup uninstall registry key (matches installer.iss AppId)
const UNINSTALL_REG_KEY = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}_is1';

// Timeout constants (ms)
const REGISTRY_TIMEOUT    = 5000;    // Registry query timeout
const API_REQUEST_TIMEOUT = 15000;   // GitHub API request timeout
const DOWNLOAD_TIMEOUT    = 120000;  // File download timeout

// Trusted hostnames for redirect following
const TRUSTED_REDIRECT_HOSTS = [
    'api.github.com',
    'github.com',
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'github-cloud.s3.amazonaws.com'
];

function _isTrustedRedirectHost(hostname) {
    return TRUSTED_REDIRECT_HOSTS.some(function (h) {
        return hostname === h || hostname.endsWith('.' + h);
    });
}

/**
 * Check if Library Manager is installed (not portable) by reading the
 * Windows uninstall registry key written by the Inno Setup installer.
 * Returns { installed: boolean, installPath: string, version: string }
 */
function isInstalledApp() {
    try {
        // Query the Inno Setup uninstall registry key for InstallLocation
        var regOutput = execSync(
            'reg query "HKLM\\' + UNINSTALL_REG_KEY + '" /v InstallLocation',
            { encoding: 'utf8', timeout: REGISTRY_TIMEOUT, windowsHide: true }
        );
        var installMatch = regOutput.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
        var installPath = installMatch ? installMatch[1].trim() : '';

        // Also get the installed version
        var verOutput = execSync(
            'reg query "HKLM\\' + UNINSTALL_REG_KEY + '" /v DisplayVersion',
            { encoding: 'utf8', timeout: REGISTRY_TIMEOUT, windowsHide: true }
        );
        var verMatch = verOutput.match(/DisplayVersion\s+REG_SZ\s+(.+)/i);
        var version = verMatch ? verMatch[1].trim() : '';

        // Verify the exe actually exists at the install path
        if (installPath) {
            var exePath = path.join(installPath, 'Library Manager.exe');
            if (fs.existsSync(exePath)) {
                // Verify current process is running from the install directory
                var currentExeDir = path.dirname(process.execPath).toLowerCase().replace(/\\$/, '');
                var registeredDir = installPath.toLowerCase().replace(/\\$/, '');
                if (currentExeDir === registeredDir) {
                    return { installed: true, installPath: installPath, version: version };
                }
            }
        }
        return { installed: false, installPath: '', version: '' };
    } catch (e) {
        return { installed: false, installPath: '', version: '' };
    }
}

/**
 * Compare two semver-like version strings.
 * Handles pre-release suffixes (e.g. "1.2.0-rc1" < "1.2.0").
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
    var strA = (a || '0').replace(/^v/i, '');
    var strB = (b || '0').replace(/^v/i, '');
    // Split on hyphen to separate version from pre-release
    var mainA = strA.split('-')[0];
    var mainB = strB.split('-')[0];
    var preA  = strA.indexOf('-') !== -1 ? strA.substring(strA.indexOf('-') + 1) : null;
    var preB  = strB.indexOf('-') !== -1 ? strB.substring(strB.indexOf('-') + 1) : null;
    var partsA = mainA.split('.').map(Number);
    var partsB = mainB.split('.').map(Number);
    var maxLen = Math.max(partsA.length, partsB.length);
    for (var i = 0; i < maxLen; i++) {
        var numA = partsA[i] || 0;
        var numB = partsB[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
    }
    // Same numeric version: pre-release < release
    if (preA !== null && preB === null) return -1;
    if (preA === null && preB !== null) return 1;
    if (preA !== null && preB !== null) {
        return preA < preB ? -1 : (preA > preB ? 1 : 0);
    }
    return 0;
}

/**
 * Fetch the latest release info from GitHub.
 * Returns a Promise that resolves with the release JSON object.
 */
function fetchLatestRelease() {
    return new Promise(function (resolve, reject) {
        var options = {
            hostname: API_HOST,
            path: RELEASES_API,
            method: 'GET',
            headers: {
                'User-Agent': 'Library-Manager-Updater',
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: API_REQUEST_TIMEOUT
        };

        var req = https.request(options, function (res) {
            // Handle redirects (GitHub sometimes redirects)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                var redirectUrl;
                try { redirectUrl = new URL(res.headers.location); } catch (_) {
                    return reject(new Error('Invalid redirect URL'));
                }
                if (!_isTrustedRedirectHost(redirectUrl.hostname)) {
                    return reject(new Error('Redirect to untrusted host: ' + redirectUrl.hostname));
                }
                var redirOpts = {
                    hostname: redirectUrl.hostname,
                    path: redirectUrl.pathname + redirectUrl.search,
                    method: 'GET',
                    headers: options.headers,
                    timeout: API_REQUEST_TIMEOUT
                };
                var redirReq = https.request(redirOpts, function (redirRes) {
                    _collectResponse(redirRes, resolve, reject);
                });
                redirReq.on('error', reject);
                redirReq.on('timeout', function () { redirReq.destroy(); reject(new Error('Request timed out')); });
                redirReq.end();
                return;
            }

            _collectResponse(res, resolve, reject);
        });

        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('Request timed out')); });
        req.end();
    });
}

function _collectResponse(res, resolve, reject) {
    if (res.statusCode !== 200) {
        return reject(new Error('GitHub API returned status ' + res.statusCode));
    }
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
        try {
            resolve(JSON.parse(data));
        } catch (e) {
            reject(new Error('Failed to parse GitHub response'));
        }
    });
    res.on('error', reject);
}

/**
 * Parse a GitHub release object into a usable update info structure.
 * Looks for .exe installer asset and lightweight patch .zip asset in the release.
 *
 * Lightweight (UAC-free) updates:
 *   If the release contains an asset named "update-manifest.json", it is fetched
 *   and parsed. If updateType === "lightweight" and a _patch.zip asset exists,
 *   the updater can apply the patch without running the full installer.
 */
function parseReleaseInfo(release) {
    var tagName = (release.tag_name || '').replace(/^v/i, '');
    var assets = release.assets || [];

    // Find the installer .exe asset (e.g., LibraryManager_v2.98.83_Setup.exe)
    var installerAsset = null;
    // Find a lightweight patch .zip asset (e.g., LibraryManager_v3.0.3_patch.zip)
    var patchAsset = null;
    // Find the update-manifest.json asset
    var updateManifestAsset = null;

    for (var i = 0; i < assets.length; i++) {
        var name = (assets[i].name || '').toLowerCase();
        if (name.endsWith('.exe') && (name.indexOf('setup') !== -1 || name.indexOf('install') !== -1)) {
            installerAsset = assets[i];
        }
        if (name.endsWith('_patch.zip') || name === 'patch.zip') {
            patchAsset = assets[i];
        }
        if (name === 'update-manifest.json') {
            updateManifestAsset = assets[i];
        }
    }

    return {
        version: tagName,
        tagName: release.tag_name || '',
        name: release.name || '',
        body: release.body || '',
        publishedAt: release.published_at || '',
        htmlUrl: release.html_url || '',
        installerAsset: installerAsset ? {
            name: installerAsset.name,
            downloadUrl: installerAsset.browser_download_url,
            size: installerAsset.size
        } : null,
        patchAsset: patchAsset ? {
            name: patchAsset.name,
            downloadUrl: patchAsset.browser_download_url,
            size: patchAsset.size
        } : null,
        updateManifestUrl: updateManifestAsset
            ? updateManifestAsset.browser_download_url
            : null
    };
}

/**
 * Check for updates. Returns a Promise resolving to:
 * { updateAvailable: boolean, currentVersion, latestVersion, releaseInfo }
 * Only checks if app is installed. Returns updateAvailable=false for portable.
 */
function checkForUpdate(currentVersion) {
    var installStatus = isInstalledApp();
    if (!installStatus.installed) {
        return Promise.resolve({
            updateAvailable: false,
            isInstalled: false,
            currentVersion: currentVersion,
            latestVersion: currentVersion,
            releaseInfo: null,
            reason: 'not-installed'
        });
    }

    return fetchLatestRelease().then(function (release) {
        var info = parseReleaseInfo(release);
        var hasUpdate = compareVersions(info.version, currentVersion) > 0;

        return {
            updateAvailable: hasUpdate,
            isInstalled: true,
            currentVersion: currentVersion,
            latestVersion: info.version,
            releaseInfo: info,
            reason: hasUpdate ? 'update-available' : 'up-to-date'
        };
    });
}

/**
 * Download a file from a URL to a local path with progress callback.
 * progressCb receives (downloadedBytes, totalBytes).
 * If abortHandle is provided (an object), a function abortHandle.abort will be
 * set that the caller can invoke to cancel the in-flight download.
 * Returns a Promise resolving to the file path.
 */
function downloadUpdate(url, destPath, progressCb, abortHandle) {
    return new Promise(function (resolve, reject) {
        _downloadWithRedirects(url, destPath, progressCb, 0, resolve, reject, abortHandle);
    });
}

function _downloadWithRedirects(url, destPath, progressCb, redirectCount, resolve, reject, abortHandle) {
    if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
    }

    var parsedUrl;
    try { parsedUrl = new URL(url); } catch (_) {
        return reject(new Error('Invalid download URL'));
    }

    var options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'Library-Manager-Updater'
        },
        timeout: DOWNLOAD_TIMEOUT
    };

    if (parsedUrl.protocol !== 'https:') {
        return reject(new Error('Insecure protocol refused: ' + parsedUrl.protocol));
    }
    var protocol = https;

    var req = protocol.request(options, function (res) {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            var location = res.headers.location;
            if (!location) return reject(new Error('Redirect without location'));
            var redirectUrl;
            try { redirectUrl = new URL(location); } catch (_) {
                return reject(new Error('Invalid redirect URL'));
            }
            if (!_isTrustedRedirectHost(redirectUrl.hostname)) {
                return reject(new Error('Redirect to untrusted host: ' + redirectUrl.hostname));
            }
            return _downloadWithRedirects(location, destPath, progressCb, redirectCount + 1, resolve, reject, abortHandle);
        }

        if (res.statusCode !== 200) {
            return reject(new Error('Download failed with status ' + res.statusCode));
        }

        var totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        var downloadedBytes = 0;
        var fileStream = fs.createWriteStream(destPath);

        res.on('data', function (chunk) {
            downloadedBytes += chunk.length;
            if (progressCb) progressCb(downloadedBytes, totalBytes);
        });

        res.pipe(fileStream);

        fileStream.on('finish', function () {
            fileStream.close(function () {
                resolve(destPath);
            });
        });

        fileStream.on('error', function (err) {
            // Clean up partial file
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
        });
    });

    req.on('error', function (err) {
        try { fs.unlinkSync(destPath); } catch (_) {}
        if (err.message === 'Download cancelled by user') return;  // already rejected
        reject(err);
    });
    req.on('timeout', function () {
        req.destroy();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(new Error('Download timed out'));
    });

    // Expose abort capability so the UI can cancel the download
    if (abortHandle && typeof abortHandle === 'object') {
        abortHandle.abort = function () {
            req.destroy(new Error('Download cancelled by user'));
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(new Error('Download cancelled by user'));
        };
    }

    req.end();
}

/**
 * Launch the downloaded installer in silent mode and exit the app.
 * The installer handles closing running instances via CloseApplications=yes.
 * @param {string} installerPath - Path to the downloaded .exe installer
 * @param {object} nwWindow - NW.js window reference (for closing the app)
 */
function launchInstaller(installerPath, nwWindow) {
    // Verify the file exists and is an exe
    if (!fs.existsSync(installerPath)) {
        throw new Error('Installer file not found: ' + installerPath);
    }

    // Launch the installer with /SILENT flag (no user interaction needed for upgrade)
    // /CLOSEAPPLICATIONS tells Inno Setup to close running instances
    // /RESTARTAPPLICATIONS tells it to restart after install
    var child = spawn(installerPath, ['/SILENT', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    });
    child.unref();

    // Close the app after a brief delay to let the installer start
    setTimeout(function () {
        if (nwWindow) {
            try { nwWindow.close(true); } catch (_) {}
        }
        try { process.exit(0); } catch (_) {}
    }, 1500);
}

/**
 * Convert GitHub markdown release notes body to simple HTML.
 * Handles basic markdown: headers, bold, italic, lists, links, code.
 *
 * NOTE: This is an intentionally minimal, hand-rolled Markdown converter.
 * It only needs to render GitHub release notes in a simple dialog — not
 * arbitrary user-authored Markdown. A full library (marked, remark, etc.)
 * would add unnecessary dependency weight for this narrow use case.
 */
function markdownToHtml(md) {
    if (!md) return '<p>No release notes available.</p>';

    var html = md
        // Escape HTML entities first
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headers
        .replace(/^### (.+)$/gm, '<h6>$1</h6>')
        .replace(/^## (.+)$/gm, '<h5>$1</h5>')
        .replace(/^# (.+)$/gm, '<h4>$1</h4>')
        // Bold and italic
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Unordered list items
        .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> items in <ul>
        .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul style="margin:0;padding-left:18px;">$1</ul>')
        // Links: [text](url) - only allow http/https URLs
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        // Line breaks (double newline = paragraph break)
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

    return html;
}

/**
 * Get the path for storing downloaded update installers.
 * Uses a temp directory within the app's local data folder.
 */
function getUpdateDownloadDir() {
    var tempDir = path.join(os.tmpdir(), 'LibraryManager-Updates');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

/**
 * Clean up old downloaded installer files.
 */
function cleanupDownloads() {
    try {
        var dir = getUpdateDownloadDir();
        var files = fs.readdirSync(dir);
        for (var i = 0; i < files.length; i++) {
            try {
                fs.unlinkSync(path.join(dir, files[i]));
            } catch (_) {}
        }
    } catch (_) {}
}

/**
 * Format a relative time string from an ISO date.
 */
function formatRelativeTime(isoDate) {
    if (!isoDate) return '';
    try {
        var then = new Date(isoDate).getTime();
        var now = Date.now();
        var diffMs = now - then;
        var diffMins = Math.floor(diffMs / 60000);
        var diffHours = Math.floor(diffMs / 3600000);
        var diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Released just now';
        if (diffMins < 60) return 'Released ' + diffMins + ' minute' + (diffMins === 1 ? '' : 's') + ' ago';
        if (diffHours < 24) return 'Released ' + diffHours + ' hour' + (diffHours === 1 ? '' : 's') + ' ago';
        if (diffDays < 30) return 'Released ' + diffDays + ' day' + (diffDays === 1 ? '' : 's') + ' ago';
        return 'Released on ' + new Date(isoDate).toLocaleDateString();
    } catch (_) {
        return '';
    }
}

// ========================================================================
// Lightweight (UAC-free) update support
// ========================================================================

/**
 * Directories that can be patched without admin privileges.
 * These directories are granted users-modify permissions by the Inno Setup installer.
 * All paths in a patch ZIP must land inside one of these (relative to the app root).
 */
var LIGHTWEIGHT_PATCHABLE_DIRS = [
    'html', 'lib', 'assets', 'icons', 'tools', 'local', 'com'
];

/**
 * Root-level files that can be patched without admin privileges.
 * These are individual files at the app root that the lightweight updater
 * is allowed to overwrite (the app dir itself has users-modify via installer).
 */
var LIGHTWEIGHT_PATCHABLE_ROOT_FILES = [
    'package.json', 'cli.js', 'com-bridge.js', 'cli-schema.json',
    'cli-spec-example.json', 'README.md', 'LICENSE', 'NOTICE',
    'PRIVACY_POLICY.txt', 'TERMS_OF_USE.txt', 'Library Manager.chm',
    'sri-hashes.txt'
];

/**
 * Fetch the update-manifest.json from a GitHub release.
 * Returns a Promise resolving to the parsed JSON, or null on failure.
 *
 * Expected manifest format:
 * {
 *   "updateType": "lightweight" | "full",
 *   "patchAsset": "LibraryManager_v3.0.3_patch.zip",  // only for lightweight
 *   "changedFiles": ["html/js/main.js", "lib/shared.js", ...]  // optional
 * }
 */
function fetchUpdateManifest(url) {
    if (!url) return Promise.resolve(null);
    return new Promise(function (resolve) {
        _downloadToBuffer(url, 0, function (err, buf) {
            if (err || !buf) return resolve(null);
            try {
                resolve(JSON.parse(buf.toString('utf8')));
            } catch (_) {
                resolve(null);
            }
        });
    });
}

function _downloadToBuffer(url, redirectCount, cb) {
    if (redirectCount > 5) return cb(new Error('Too many redirects'));
    var parsedUrl;
    try { parsedUrl = new URL(url); } catch (_) { return cb(new Error('Invalid URL')); }

    if (parsedUrl.protocol !== 'https:') {
        return cb(new Error('Insecure protocol refused: ' + parsedUrl.protocol));
    }
    var req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { 'User-Agent': 'Library-Manager-Updater' },
        timeout: API_REQUEST_TIMEOUT
    }, function (res) {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            var loc = res.headers.location;
            if (!loc) return cb(new Error('Redirect without location'));
            var redirectUrl;
            try { redirectUrl = new URL(loc); } catch (_) {
                return cb(new Error('Invalid redirect URL'));
            }
            if (!_isTrustedRedirectHost(redirectUrl.hostname)) {
                return cb(new Error('Redirect to untrusted host: ' + redirectUrl.hostname));
            }
            return _downloadToBuffer(loc, redirectCount + 1, cb);
        }
        if (res.statusCode !== 200) return cb(new Error('HTTP ' + res.statusCode));
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { cb(null, Buffer.concat(chunks)); });
        res.on('error', cb);
    });
    req.on('error', cb);
    req.on('timeout', function () { req.destroy(); cb(new Error('Timeout')); });
    req.end();
}

/**
 * Determine if a lightweight (UAC-free) update is possible for a release.
 * Returns a Promise resolving to:
 * {
 *   canPatchLightweight: boolean,
 *   reason: string,
 *   patchAsset: { name, downloadUrl, size } | null
 * }
 */
function canApplyLightweightUpdate(releaseInfo) {
    if (!releaseInfo) {
        return Promise.resolve({ canPatchLightweight: false, reason: 'no-release-info', patchAsset: null });
    }

    // Must have a patch asset
    if (!releaseInfo.patchAsset) {
        return Promise.resolve({ canPatchLightweight: false, reason: 'no-patch-asset', patchAsset: null });
    }

    // Must have an update manifest URL
    if (!releaseInfo.updateManifestUrl) {
        return Promise.resolve({ canPatchLightweight: false, reason: 'no-update-manifest', patchAsset: null });
    }

    return fetchUpdateManifest(releaseInfo.updateManifestUrl).then(function (manifest) {
        if (!manifest || manifest.updateType !== 'lightweight') {
            return { canPatchLightweight: false, reason: 'update-type-full', patchAsset: null };
        }
        return {
            canPatchLightweight: true,
            reason: 'lightweight',
            patchAsset: releaseInfo.patchAsset
        };
    });
}

/**
 * Validate that all files in a patch ZIP are within allowed directories.
 * Returns { safe: boolean, blockedFiles: string[] }
 */
function validatePatchContents(zipEntries) {
    var blockedFiles = [];
    for (var i = 0; i < zipEntries.length; i++) {
        var entryName = zipEntries[i].replace(/\\/g, '/');
        if (!entryName || entryName.endsWith('/')) continue; // skip directories

        // Check for path traversal
        if (entryName.indexOf('..') !== -1) {
            blockedFiles.push(entryName);
            continue;
        }

        // Check if it's a root-level file
        if (entryName.indexOf('/') === -1) {
            if (LIGHTWEIGHT_PATCHABLE_ROOT_FILES.indexOf(entryName) === -1) {
                blockedFiles.push(entryName);
            }
            continue;
        }

        // Check if it's inside an allowed directory
        var topDir = entryName.split('/')[0];
        if (LIGHTWEIGHT_PATCHABLE_DIRS.indexOf(topDir) === -1) {
            blockedFiles.push(entryName);
        }
    }
    return { safe: blockedFiles.length === 0, blockedFiles: blockedFiles };
}

/**
 * Apply a lightweight patch by extracting a ZIP over the install directory.
 * @param {string} patchZipPath - Path to the downloaded patch ZIP
 * @param {string} installPath - App install directory (e.g. C:\Program Files (x86)\Library Manager)
 * @param {function} progressCb - Optional callback(extractedCount, totalCount)
 * @returns {{ success: boolean, filesUpdated: number, error: string|null }}
 */
function applyLightweightPatch(patchZipPath, installPath, progressCb) {
    var AdmZip;
    try {
        AdmZip = require('adm-zip');
    } catch (e) {
        try {
            AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'));
        } catch (e2) {
            return { success: false, filesUpdated: 0, error: 'adm-zip module not available' };
        }
    }

    try {
        var zip = new AdmZip(patchZipPath);
        var entries = zip.getEntries();

        // Validate: all files must be in allowed directories
        var entryNames = entries.map(function (e) { return e.entryName; });
        var validation = validatePatchContents(entryNames);
        if (!validation.safe) {
            return {
                success: false,
                filesUpdated: 0,
                error: 'Patch contains files outside allowed directories: ' + validation.blockedFiles.join(', ')
            };
        }

        var filesUpdated = 0;
        var totalFiles = entries.filter(function (e) { return !e.isDirectory; }).length;

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.isDirectory) continue;

            var destPath = path.join(installPath, entry.entryName.replace(/\//g, path.sep));

            // Path traversal guard
            var resolvedDest = path.resolve(destPath);
            var resolvedBase = path.resolve(installPath);
            if (!resolvedDest.startsWith(resolvedBase + path.sep) && resolvedDest !== resolvedBase) {
                continue; // skip unsafe paths
            }

            var destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            fs.writeFileSync(destPath, entry.getData());
            filesUpdated++;

            if (progressCb) progressCb(filesUpdated, totalFiles);
        }

        return { success: true, filesUpdated: filesUpdated, error: null };
    } catch (err) {
        return { success: false, filesUpdated: 0, error: err.message };
    }
}

/**
 * Restart the app after a lightweight patch (no installer needed).
 * @param {object} nwWindow - NW.js window reference
 */
function restartApp(nwWindow) {
    var exePath = process.execPath;
    var child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(function () {
        if (nwWindow) {
            try { nwWindow.close(true); } catch (_) {}
        }
        try { process.exit(0); } catch (_) {}
    }, 500);
}

// ========================================================================
// Delta update support (in-app, no UAC, no Inno Setup UI)
// ========================================================================

/**
 * Path to innounp.exe relative to the app root.
 * Bundled in tools/innounp/ by the installer.
 */
var INNOUNP_EXE = path.join('tools', 'innounp', 'innounp.exe');

/**
 * Directories and root files to skip during delta comparison.
 * db/ and local/ contain user data that must never be overwritten by updates.
 */
var DELTA_SKIP_DIRS = ['db', 'local'];

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function hashFile(filePath) {
    var data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Resolve the absolute path to innounp.exe.
 * Checks the install directory first, then the app's running directory.
 * @param {string} installPath - App install directory
 * @returns {string|null} absolute path or null if not found
 */
function resolveInnounpPath(installPath) {
    var candidates = [
        path.join(installPath, INNOUNP_EXE),
        path.join(path.dirname(process.execPath), INNOUNP_EXE)
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (fs.existsSync(candidates[i])) return candidates[i];
    }
    return null;
}

/**
 * Extract an Inno Setup .exe installer to a staging directory using innounp.
 * Returns a Promise resolving to the staging directory path.
 *
 * @param {string} installerPath - Path to the downloaded .exe
 * @param {string} innounpPath - Absolute path to innounp.exe
 * @param {function} statusCb - Optional callback(message) for progress updates
 * @returns {Promise<string>} staging directory path
 */
function extractInstallerToStaging(installerPath, innounpPath, statusCb) {
    return new Promise(function (resolve, reject) {
        var stagingDir = path.join(getUpdateDownloadDir(), 'staging-' + Date.now());
        fs.mkdirSync(stagingDir, { recursive: true });

        if (statusCb) statusCb('Unpacking update...');

        // innounp -x -d<dest> -y <installer>
        // -x = extract, -d = destination, -y = auto-yes overwrite
        execFile(innounpPath, ['-x', '-d' + stagingDir, '-y', installerPath], {
            timeout: 120000,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024
        }, function (err, stdout, stderr) {
            if (err) {
                return reject(new Error('Failed to unpack installer: ' + (err.message || stderr)));
            }
            // innounp extracts into {app}/ subfolder inside staging dir
            // Find the actual content root
            var appDir = _findExtractedAppDir(stagingDir);
            if (!appDir) {
                return reject(new Error('Could not locate extracted app files in staging directory'));
            }
            resolve(appDir);
        });
    });
}

/**
 * After innounp extraction, find the directory containing the actual app files.
 * innounp typically extracts into a structure like: staging/{app}/...
 * @param {string} stagingDir
 * @returns {string|null}
 */
function _findExtractedAppDir(stagingDir) {
    // innounp creates {app}/ folder for files destined to the install dir
    var appSubDir = path.join(stagingDir, '{app}');
    if (fs.existsSync(appSubDir) && fs.statSync(appSubDir).isDirectory()) {
        return appSubDir;
    }
    // Some versions may extract directly
    if (fs.existsSync(path.join(stagingDir, 'package.json'))) {
        return stagingDir;
    }
    // Search one level deep for package.json
    try {
        var entries = fs.readdirSync(stagingDir);
        for (var i = 0; i < entries.length; i++) {
            var sub = path.join(stagingDir, entries[i]);
            if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, 'package.json'))) {
                return sub;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Recursively walk a directory tree and return relative file paths.
 * @param {string} baseDir - Root directory
 * @param {string} subDir - Current subdirectory (relative to baseDir)
 * @returns {string[]} array of relative paths (forward-slash separated)
 */
function _walkDir(baseDir, subDir) {
    var result = [];
    var fullDir = subDir ? path.join(baseDir, subDir) : baseDir;
    var entries;
    try { entries = fs.readdirSync(fullDir); } catch (_) { return result; }

    for (var i = 0; i < entries.length; i++) {
        var relPath = subDir ? subDir + '/' + entries[i] : entries[i];
        var fullPath = path.join(fullDir, entries[i]);
        var stat;
        try { stat = fs.statSync(fullPath); } catch (_) { continue; }

        if (stat.isDirectory()) {
            result = result.concat(_walkDir(baseDir, relPath));
        } else {
            result.push(relPath);
        }
    }
    return result;
}

/**
 * Build a delta (list of changed/new files) between staging and installed directories.
 * Skips user data directories (db/, local/).
 *
 * @param {string} stagingDir - Extracted update files
 * @param {string} installDir - Current installed app directory
 * @param {function} statusCb - Optional callback(message) for progress
 * @returns {{ changed: string[], added: string[], unchanged: number, skipped: number }}
 */
function buildDelta(stagingDir, installDir, statusCb) {
    if (statusCb) statusCb('Comparing files...');

    var stagingFiles = _walkDir(stagingDir, '');
    var changed = [];
    var added = [];
    var unchanged = 0;
    var skipped = 0;

    for (var i = 0; i < stagingFiles.length; i++) {
        var relFile = stagingFiles[i];

        // Skip user data directories
        var topDir = relFile.split('/')[0];
        if (DELTA_SKIP_DIRS.indexOf(topDir) !== -1) {
            skipped++;
            continue;
        }

        var installedFile = path.join(installDir, relFile.replace(/\//g, path.sep));
        var stagingFile = path.join(stagingDir, relFile.replace(/\//g, path.sep));

        if (!fs.existsSync(installedFile)) {
            added.push(relFile);
        } else {
            var stagingHash = hashFile(stagingFile);
            var installedHash = hashFile(installedFile);
            if (stagingHash !== installedHash) {
                changed.push(relFile);
            } else {
                unchanged++;
            }
        }
    }

    return { changed: changed, added: added, unchanged: unchanged, skipped: skipped };
}

/**
 * Apply a delta — copy only changed/new files from staging to install directory.
 * @param {string} stagingDir - Extracted update files
 * @param {string} installDir - Current installed app directory
 * @param {string[]} filesToCopy - Array of relative paths to copy
 * @param {function} progressCb - Optional callback(copiedCount, totalCount, currentFile)
 * @returns {{ success: boolean, filesCopied: number, errors: string[] }}
 */
function applyDelta(stagingDir, installDir, filesToCopy, progressCb) {
    var copied = 0;
    var errors = [];

    for (var i = 0; i < filesToCopy.length; i++) {
        var relFile = filesToCopy[i];
        var srcFile = path.join(stagingDir, relFile.replace(/\//g, path.sep));
        var destFile = path.join(installDir, relFile.replace(/\//g, path.sep));

        // Path traversal guard
        var resolvedDest = path.resolve(destFile);
        var resolvedBase = path.resolve(installDir);
        if (!resolvedDest.startsWith(resolvedBase + path.sep) && resolvedDest !== resolvedBase) {
            errors.push('Blocked path traversal: ' + relFile);
            continue;
        }

        try {
            // Ensure destination directory exists
            var destDir = path.dirname(destFile);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(srcFile, destFile);
            copied++;

            if (progressCb) progressCb(copied, filesToCopy.length, relFile);
        } catch (err) {
            errors.push(relFile + ': ' + err.message);
        }
    }

    return {
        success: errors.length === 0,
        filesCopied: copied,
        errors: errors
    };
}

/**
 * Clean up staging directory after update.
 * @param {string} stagingDir
 */
function cleanupStaging(stagingDir) {
    try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (_) {}
}

/**
 * Full delta update orchestrator.
 * Downloads the Inno Setup .exe, unpacks it, computes deltas, applies only changed files.
 * No UAC, no Inno Setup UI, no COM re-registration.
 *
 * @param {object} opts
 * @param {string} opts.downloadUrl - URL of the .exe installer
 * @param {string} opts.assetName - Filename for the download
 * @param {string} opts.installPath - Current app install directory
 * @param {function} opts.downloadProgressCb - callback(downloaded, total) for download phase
 * @param {function} opts.statusCb - callback(message) for status text updates
 * @param {function} opts.deltaProgressCb - callback(copied, total, filename) for install phase
 * @returns {Promise<{ success: boolean, filesCopied: number, filesUnchanged: number, errors: string[] }>}
 */
function applyDeltaUpdate(opts) {
    var downloadDir = getUpdateDownloadDir();
    var destPath = path.join(downloadDir, opts.assetName);
    var innounpPath = resolveInnounpPath(opts.installPath);
    var stagingDir = null;

    if (!innounpPath) {
        return Promise.reject(new Error('innounp.exe not found — cannot perform in-app update'));
    }

    // Phase 1: Download
    if (opts.statusCb) opts.statusCb('Downloading update...');
    return downloadUpdate(opts.downloadUrl, destPath, opts.downloadProgressCb, opts.abortHandle)
        .then(function (exePath) {
            // Phase 2: Unpack
            if (opts.statusCb) opts.statusCb('Unpacking update...');
            return extractInstallerToStaging(exePath, innounpPath, opts.statusCb);
        })
        .then(function (extractedDir) {
            stagingDir = extractedDir;

            // Phase 3: Compute delta
            if (opts.statusCb) opts.statusCb('Resolving changes...');
            var delta = buildDelta(stagingDir, opts.installPath, opts.statusCb);
            var filesToCopy = delta.changed.concat(delta.added);

            if (filesToCopy.length === 0) {
                cleanupStaging(path.dirname(stagingDir));
                return {
                    success: true,
                    filesCopied: 0,
                    filesUnchanged: delta.unchanged,
                    errors: []
                };
            }

            // Phase 4: Apply delta
            if (opts.statusCb) {
                opts.statusCb('Installing ' + filesToCopy.length + ' updated file' +
                    (filesToCopy.length === 1 ? '' : 's') + '...');
            }
            var result = applyDelta(stagingDir, opts.installPath, filesToCopy, opts.deltaProgressCb);
            result.filesUnchanged = delta.unchanged;

            // Phase 5: Cleanup
            cleanupStaging(path.dirname(stagingDir));
            cleanupDownloads();

            return result;
        })
        .catch(function (err) {
            // Cleanup on failure
            if (stagingDir) {
                try { cleanupStaging(path.dirname(stagingDir)); } catch (_) {}
            }
            throw err;
        });
}

// Export all public functions
module.exports = {
    isInstalledApp: isInstalledApp,
    compareVersions: compareVersions,
    checkForUpdate: checkForUpdate,
    fetchLatestRelease: fetchLatestRelease,
    parseReleaseInfo: parseReleaseInfo,
    downloadUpdate: downloadUpdate,
    launchInstaller: launchInstaller,
    markdownToHtml: markdownToHtml,
    getUpdateDownloadDir: getUpdateDownloadDir,
    cleanupDownloads: cleanupDownloads,
    formatRelativeTime: formatRelativeTime,
    // Lightweight update support
    canApplyLightweightUpdate: canApplyLightweightUpdate,
    fetchUpdateManifest: fetchUpdateManifest,
    validatePatchContents: validatePatchContents,
    applyLightweightPatch: applyLightweightPatch,
    restartApp: restartApp,
    // Delta update support (in-app, no UAC)
    resolveInnounpPath: resolveInnounpPath,
    extractInstallerToStaging: extractInstallerToStaging,
    buildDelta: buildDelta,
    applyDelta: applyDelta,
    applyDeltaUpdate: applyDeltaUpdate,
    cleanupStaging: cleanupStaging,
    hashFile: hashFile
};
