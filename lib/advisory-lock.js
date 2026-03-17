// SPDX-License-Identifier: Apache-2.0
/**
 * Library Manager - Advisory File Lock
 *
 * Copyright (c) 2026 Zachary Milot
 * Author: Zachary Milot
 *
 * Cross-process advisory locking using exclusive file creation (O_EXCL).
 * Protects concurrent database operations when multiple CLI processes or
 * the GUI and CLI run simultaneously against the same data directory.
 *
 * Usage:
 *   const lock = require('./advisory-lock');
 *   lock.withLock(dbPath, 'install', function() {
 *       // ... critical section ...
 *   });
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOCK_DIR     = '.locks';
const STALE_MS     = 30000;   // 30 s — assume dead if older
const MAX_WAIT_MS  = 15000;   // 15 s — give up after this
const RETRY_MS     = 50;      // poll interval

/**
 * Sanitize a lock name to a safe filename component.
 * @param {string} name
 * @returns {string}
 */
function safeName(name) {
    return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 120);
}

/**
 * Return the directory used for lock files, creating it if needed.
 * @param {string} basePath - Typically the database directory.
 * @returns {string}
 */
function lockDir(basePath) {
    var dir = path.join(basePath, LOCK_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Check whether a lock file is stale (owning process gone or too old).
 * @param {string} lockFile
 * @param {number} staleMs
 * @returns {boolean}
 */
function isStale(lockFile, staleMs) {
    try {
        var raw = fs.readFileSync(lockFile, 'utf8');
        var info = JSON.parse(raw);
        if (Date.now() - info.ts > staleMs) return true;
        try { process.kill(info.pid, 0); } catch (_) { return true; }
        return false;
    } catch (_) {
        return true;          // unreadable / corrupt → treat as stale
    }
}

/**
 * Acquire an advisory lock.  Blocks synchronously until the lock is
 * obtained or the timeout expires.
 *
 * @param {string} basePath  - Directory that anchors the lock namespace.
 * @param {string} name      - Logical lock name (e.g. 'install').
 * @param {object} [opts]
 * @param {number} [opts.staleMs=30000]
 * @param {number} [opts.maxWaitMs=15000]
 * @returns {string} Absolute path to the lock file (needed for release).
 * @throws If the lock cannot be acquired within the timeout.
 */
function acquireLock(basePath, name, opts) {
    opts = opts || {};
    var staleMs    = opts.staleMs    || STALE_MS;
    var maxWaitMs  = opts.maxWaitMs  || MAX_WAIT_MS;
    var lockFile   = path.join(lockDir(basePath), safeName(name) + '.lock');
    var deadline   = Date.now() + maxWaitMs;
    var payload    = JSON.stringify({ pid: process.pid, ts: Date.now() });

    while (true) {
        try {
            // O_EXCL makes this atomic — fails if the file already exists
            var fd = fs.openSync(lockFile, 'wx');
            fs.writeSync(fd, payload);
            fs.closeSync(fd);
            return lockFile;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;

            // Lock file exists — check if stale
            if (isStale(lockFile, staleMs)) {
                try { fs.unlinkSync(lockFile); } catch (_) {}
                continue;                       // retry immediately
            }

            if (Date.now() >= deadline) {
                throw new Error(
                    'Advisory lock "' + name + '" could not be acquired within '
                    + maxWaitMs + ' ms.  Another process may be holding it.'
                );
            }

            // Brief synchronous sleep to avoid busy-spin
            sleepSync(RETRY_MS);
        }
    }
}

/**
 * Release a previously acquired lock.
 * @param {string} lockFile - Path returned by acquireLock().
 */
function releaseLock(lockFile) {
    try { fs.unlinkSync(lockFile); } catch (_) {}
}

/**
 * Execute `fn` while holding the named advisory lock.
 * The lock is always released, even if `fn` throws.
 *
 * @param {string} basePath
 * @param {string} name
 * @param {Function} fn
 * @param {object} [opts]  - Forwarded to acquireLock.
 * @returns {*} Return value of `fn`.
 */
function withLock(basePath, name, fn, opts) {
    var lockFile = acquireLock(basePath, name, opts);
    try {
        return fn();
    } finally {
        releaseLock(lockFile);
    }
}

// ---------------------------------------------------------------------------
// Portable synchronous sleep (avoids busy-spin)
// ---------------------------------------------------------------------------
var _sleepBuf;
function sleepSync(ms) {
    // Atomics.wait on a SharedArrayBuffer gives a true blocking sleep
    // without burning CPU.  Available in Node ≥ 8.10.
    if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined') {
        if (!_sleepBuf) _sleepBuf = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(_sleepBuf, 0, 0, ms);
        return;
    }
    // Fallback: spin (only reached on very old runtimes)
    var end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
}

module.exports = {
    acquireLock:  acquireLock,
    releaseLock:  releaseLock,
    withLock:     withLock
};
