/**
 * updater.js - Auto-update module for Library Manager
 * Checks GitHub releases for new versions and downloads/installs updates.
 * Only operates when the app is installed (detected via Windows registry).
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

// GitHub release API endpoint
const GITHUB_OWNER = 'zdmilot';
const GITHUB_REPO = 'Library-Manager';
const RELEASES_API = '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest';
const API_HOST = 'api.github.com';

// Inno Setup uninstall registry key (matches installer.iss AppId)
const UNINSTALL_REG_KEY = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}_is1';

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
            { encoding: 'utf8', timeout: 5000, windowsHide: true }
        );
        var installMatch = regOutput.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
        var installPath = installMatch ? installMatch[1].trim() : '';

        // Also get the installed version
        var verOutput = execSync(
            'reg query "HKLM\\' + UNINSTALL_REG_KEY + '" /v DisplayVersion',
            { encoding: 'utf8', timeout: 5000, windowsHide: true }
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
            timeout: 15000
        };

        var req = https.request(options, function (res) {
            // Handle redirects (GitHub sometimes redirects)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                var redirectUrl;
                try { redirectUrl = new URL(res.headers.location); } catch (_) {
                    return reject(new Error('Invalid redirect URL'));
                }
                var redirOpts = {
                    hostname: redirectUrl.hostname,
                    path: redirectUrl.pathname + redirectUrl.search,
                    method: 'GET',
                    headers: options.headers,
                    timeout: 15000
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
 * Looks for .exe installer asset in the release.
 */
function parseReleaseInfo(release) {
    var tagName = (release.tag_name || '').replace(/^v/i, '');
    var assets = release.assets || [];

    // Find the installer .exe asset (e.g., LibraryManager_v2.98.83_Setup.exe)
    var installerAsset = null;
    for (var i = 0; i < assets.length; i++) {
        var name = (assets[i].name || '').toLowerCase();
        if (name.endsWith('.exe') && (name.indexOf('setup') !== -1 || name.indexOf('install') !== -1)) {
            installerAsset = assets[i];
            break;
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
        } : null
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
 * Returns a Promise resolving to the file path.
 */
function downloadUpdate(url, destPath, progressCb) {
    return new Promise(function (resolve, reject) {
        _downloadWithRedirects(url, destPath, progressCb, 0, resolve, reject);
    });
}

function _downloadWithRedirects(url, destPath, progressCb, redirectCount, resolve, reject) {
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
        timeout: 120000
    };

    var protocol = parsedUrl.protocol === 'https:' ? https : require('http');

    var req = protocol.request(options, function (res) {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            var location = res.headers.location;
            if (!location) return reject(new Error('Redirect without location'));
            return _downloadWithRedirects(location, destPath, progressCb, redirectCount + 1, resolve, reject);
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
        reject(err);
    });
    req.on('timeout', function () {
        req.destroy();
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(new Error('Download timed out'));
    });
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
    formatRelativeTime: formatRelativeTime
};
