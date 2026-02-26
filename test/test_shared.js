/**
 * Venus Library Manager — Shared Module Tests
 *
 * Minimal smoke tests for the shared validation, hashing, and signing
 * routines.  Run with:  npm test  (or  node test/test_shared.js)
 */

'use strict';

const path   = require('path');
const assert = require('assert');
const shared = require('../lib/shared');

let passed = 0;
let failed = 0;

function test(label, fn) {
    try {
        fn();
        passed++;
        console.log('  \u2714 ' + label);
    } catch (e) {
        failed++;
        console.error('  \u2718 ' + label);
        console.error('    ' + e.message);
    }
}

// -----------------------------------------------------------------------
console.log('\n=== isValidLibraryName ===');
// -----------------------------------------------------------------------

test('rejects empty string', function () {
    assert.strictEqual(shared.isValidLibraryName(''), false);
});

test('rejects null', function () {
    assert.strictEqual(shared.isValidLibraryName(null), false);
});

test('rejects undefined', function () {
    assert.strictEqual(shared.isValidLibraryName(undefined), false);
});

test('rejects name with backslash', function () {
    assert.strictEqual(shared.isValidLibraryName('foo\\bar'), false);
});

test('rejects name with forward slash', function () {
    assert.strictEqual(shared.isValidLibraryName('foo/bar'), false);
});

test('rejects name with .. traversal', function () {
    assert.strictEqual(shared.isValidLibraryName('..'), false);
    assert.strictEqual(shared.isValidLibraryName('foo..bar'), false);
});

test('rejects Windows reserved device names', function () {
    assert.strictEqual(shared.isValidLibraryName('CON'), false);
    assert.strictEqual(shared.isValidLibraryName('PRN'), false);
    assert.strictEqual(shared.isValidLibraryName('AUX'), false);
    assert.strictEqual(shared.isValidLibraryName('NUL'), false);
    assert.strictEqual(shared.isValidLibraryName('COM1'), false);
    assert.strictEqual(shared.isValidLibraryName('COM9'), false);
    assert.strictEqual(shared.isValidLibraryName('LPT1'), false);
    assert.strictEqual(shared.isValidLibraryName('LPT9'), false);
});

test('rejects reserved names case-insensitively', function () {
    assert.strictEqual(shared.isValidLibraryName('con'), false);
    assert.strictEqual(shared.isValidLibraryName('Con'), false);
    assert.strictEqual(shared.isValidLibraryName('nul'), false);
    assert.strictEqual(shared.isValidLibraryName('Prn'), false);
});

test('rejects reserved names with extensions', function () {
    assert.strictEqual(shared.isValidLibraryName('CON.txt'), false);
    assert.strictEqual(shared.isValidLibraryName('NUL.lib'), false);
    assert.strictEqual(shared.isValidLibraryName('COM1.hsl'), false);
});

test('accepts names containing reserved words as substrings', function () {
    assert.strictEqual(shared.isValidLibraryName('MyCONtroller'), true);
    assert.strictEqual(shared.isValidLibraryName('CONTROLLER'), true);
    assert.strictEqual(shared.isValidLibraryName('NullHandler'), true);
    assert.strictEqual(shared.isValidLibraryName('Aux-Helper'), true);
});

test('rejects name with reserved chars', function () {
    assert.strictEqual(shared.isValidLibraryName('lib<>name'), false);
    assert.strictEqual(shared.isValidLibraryName('lib:name'), false);
    assert.strictEqual(shared.isValidLibraryName('lib"name'), false);
    assert.strictEqual(shared.isValidLibraryName('lib|name'), false);
    assert.strictEqual(shared.isValidLibraryName('lib?name'), false);
    assert.strictEqual(shared.isValidLibraryName('lib*name'), false);
});

test('rejects trailing dot', function () {
    assert.strictEqual(shared.isValidLibraryName('MyLib.'), false);
});

test('rejects trailing space', function () {
    assert.strictEqual(shared.isValidLibraryName('MyLib '), false);
});

test('rejects whitespace-only name', function () {
    assert.strictEqual(shared.isValidLibraryName('   '), false);
});

test('accepts simple library name', function () {
    assert.strictEqual(shared.isValidLibraryName('MyLibrary'), true);
});

test('accepts name with dots (non-trailing)', function () {
    assert.strictEqual(shared.isValidLibraryName('My.Library.v2'), true);
});

test('accepts name with spaces (non-trailing)', function () {
    assert.strictEqual(shared.isValidLibraryName('My Library'), true);
});

test('accepts name with hyphens and underscores', function () {
    assert.strictEqual(shared.isValidLibraryName('My-Library_v2'), true);
});

// -----------------------------------------------------------------------
console.log('\n=== escapeHtml ===');
// -----------------------------------------------------------------------

test('escapes angle brackets', function () {
    assert.strictEqual(shared.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapes ampersand', function () {
    assert.strictEqual(shared.escapeHtml('a&b'), 'a&amp;b');
});

test('escapes quotes', function () {
    assert.strictEqual(shared.escapeHtml('"hello"'), '&quot;hello&quot;');
    assert.strictEqual(shared.escapeHtml("'hi'"), '&#39;hi&#39;');
});

test('returns empty string for non-string', function () {
    assert.strictEqual(shared.escapeHtml(null), '');
    assert.strictEqual(shared.escapeHtml(123), '');
    assert.strictEqual(shared.escapeHtml(undefined), '');
});

// -----------------------------------------------------------------------
console.log('\n=== safeZipExtractPath ===');
// -----------------------------------------------------------------------

test('allows normal relative path', function () {
    var result = shared.safeZipExtractPath('C:\\target', 'file.txt');
    assert.ok(result !== null);
    assert.ok(result.startsWith('C:\\target'));
});

test('allows nested relative path', function () {
    var result = shared.safeZipExtractPath('C:\\target', 'subdir/file.txt');
    assert.ok(result !== null);
    assert.ok(result.startsWith('C:\\target'));
});

test('allows filenames containing double-dot substring', function () {
    // file..data.txt does not escape the target dir; the old code
    // false-positived on this because it checked for ".." as a substring
    var result = shared.safeZipExtractPath('C:\\target', 'file..data.txt');
    assert.ok(result !== null, 'should not reject benign double-dot in filename');
    assert.ok(result.startsWith('C:\\target'));
});

test('rejects .. traversal', function () {
    assert.strictEqual(shared.safeZipExtractPath('C:\\target', '../etc/passwd'), null);
});

test('rejects backslash traversal', function () {
    assert.strictEqual(shared.safeZipExtractPath('C:\\target', '..\\Windows\\system32'), null);
});

test('rejects traversal with nested ..', function () {
    assert.strictEqual(shared.safeZipExtractPath('C:\\target', 'subdir/../../etc/passwd'), null);
});

test('rejects absolute paths', function () {
    assert.strictEqual(shared.safeZipExtractPath('C:\\target', 'C:\\Windows\\system32\\cmd.exe'), null);
});

// -----------------------------------------------------------------------
console.log('\n=== computeFileHash ===');
// -----------------------------------------------------------------------

test('returns null for non-existent file', function () {
    assert.strictEqual(shared.computeFileHash('C:\\nonexistent\\file.txt'), null);
});

test('produces consistent hash for same content', function () {
    var fs = require('fs');
    var os = require('os');
    var tmpFile = path.join(os.tmpdir(), 'vlm_test_hash_' + Date.now() + '.txt');
    fs.writeFileSync(tmpFile, 'hello world');
    try {
        var h1 = shared.computeFileHash(tmpFile);
        var h2 = shared.computeFileHash(tmpFile);
        assert.ok(h1 !== null);
        assert.strictEqual(h1, h2);
        assert.strictEqual(h1.length, 64); // SHA-256 hex = 64 chars
    } finally {
        fs.unlinkSync(tmpFile);
    }
});

// -----------------------------------------------------------------------
console.log('\n=== parseHslMetadataFooter ===');
// -----------------------------------------------------------------------

test('returns null for non-existent file', function () {
    assert.strictEqual(shared.parseHslMetadataFooter('C:\\nonexistent\\file.hsl'), null);
});

test('returns null for file without footer', function () {
    var fs = require('fs');
    var os = require('os');
    var tmpFile = path.join(os.tmpdir(), 'vlm_test_nometa_' + Date.now() + '.hsl');
    fs.writeFileSync(tmpFile, 'function main() {}\n// just a comment\n');
    try {
        assert.strictEqual(shared.parseHslMetadataFooter(tmpFile), null);
    } finally {
        fs.unlinkSync(tmpFile);
    }
});

test('parses valid metadata footer', function () {
    var fs = require('fs');
    var os = require('os');
    var tmpFile = path.join(os.tmpdir(), 'vlm_test_meta_' + Date.now() + '.hsl');
    var footer = '// $$author=TestUser$$valid=1$$time=2024-01-01$$checksum=abcdef01$$length=42$$';
    fs.writeFileSync(tmpFile, 'function main() {}\n' + footer + '\n');
    try {
        var result = shared.parseHslMetadataFooter(tmpFile);
        assert.ok(result !== null);
        assert.strictEqual(result.author, 'TestUser');
        assert.strictEqual(result.valid, 1);
        assert.strictEqual(result.time, '2024-01-01');
        assert.strictEqual(result.checksum, 'abcdef01');
        assert.strictEqual(result.length, 42);
    } finally {
        fs.unlinkSync(tmpFile);
    }
});

// -----------------------------------------------------------------------
console.log('\n=== computeZipEntryHashes ===');
// -----------------------------------------------------------------------

test('hashes all non-directory entries except signature.json', function () {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip();
    zip.addFile('file1.txt', Buffer.from('content1'));
    zip.addFile('file2.txt', Buffer.from('content2'));
    zip.addFile('signature.json', Buffer.from('{}'));

    var hashes = shared.computeZipEntryHashes(zip);
    assert.ok(hashes['file1.txt']);
    assert.ok(hashes['file2.txt']);
    assert.strictEqual(hashes['signature.json'], undefined);
});

test('returns sorted keys', function () {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip();
    zip.addFile('z_file.txt', Buffer.from('z'));
    zip.addFile('a_file.txt', Buffer.from('a'));
    zip.addFile('m_file.txt', Buffer.from('m'));

    var hashes = shared.computeZipEntryHashes(zip);
    var keys = Object.keys(hashes);
    assert.deepStrictEqual(keys, ['a_file.txt', 'm_file.txt', 'z_file.txt']);
});

// -----------------------------------------------------------------------
console.log('\n=== signPackageZip / verifyPackageSignature ===');
// -----------------------------------------------------------------------

test('sign and verify round-trip succeeds', function () {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{"library_name":"Test"}'));
    zip.addFile('library/test.hsl', Buffer.from('function main() {}'));

    shared.signPackageZip(zip);
    var result = shared.verifyPackageSignature(zip);
    assert.strictEqual(result.signed, true);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
});

test('verify detects tampering', function () {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{"library_name":"Test"}'));
    zip.addFile('library/test.hsl', Buffer.from('function main() {}'));
    shared.signPackageZip(zip);

    // Tamper with a file after signing
    zip.addFile('library/test.hsl', Buffer.from('TAMPERED'));
    var result = shared.verifyPackageSignature(zip);
    assert.strictEqual(result.signed, true);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
});

test('verify reports unsigned package', function () {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{}'));
    var result = shared.verifyPackageSignature(zip);
    assert.strictEqual(result.signed, false);
});

// -----------------------------------------------------------------------
console.log('\n=== Constants ===');
// -----------------------------------------------------------------------

test('HASH_EXTENSIONS contains expected values', function () {
    assert.ok(shared.HASH_EXTENSIONS.indexOf('.hsl') !== -1);
    assert.ok(shared.HASH_EXTENSIONS.indexOf('.hs_') !== -1);
    assert.ok(shared.HASH_EXTENSIONS.indexOf('.sub') !== -1);
});

test('HSL_METADATA_EXTS contains expected values', function () {
    assert.ok(shared.HSL_METADATA_EXTS.indexOf('.hsl') !== -1);
    assert.ok(shared.HSL_METADATA_EXTS.indexOf('.smt') !== -1);
});

test('IMAGE_MIME_MAP has PNG entry', function () {
    assert.strictEqual(shared.IMAGE_MIME_MAP['.png'], 'image/png');
});

// -----------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------
console.log('\n' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
