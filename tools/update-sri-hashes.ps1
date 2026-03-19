<#
.SYNOPSIS
    Recomputes SHA-384 SRI hashes for all protected files and updates
    html/index.html and sri-hashes.txt if any hash is stale.

.DESCRIPTION
    Designed to be called from a Git pre-commit hook (or manually).
    If any SRI-protected file's content has changed, this script:
      1. Computes the correct SHA-384 hash from the file on disk
      2. Replaces every occurrence of the old hash in index.html
      3. Updates sri-hashes.txt for the custom files
      4. Stages the modified index.html / sri-hashes.txt so the
         commit includes the corrected hashes automatically.

    Exit code 0 = success (hashes were already correct, or were fixed).
    Exit code 1 = error (file not found, etc.).
#>

param(
    [switch]$NoStage  # skip "git add" — useful when running outside a hook
)

$ErrorActionPreference = 'Stop'

# ── Resolve repo root ──────────────────────────────────────────────
$repoRoot = $null
if ($PSScriptRoot) {
    $candidate = Split-Path -Parent $PSScriptRoot   # tools/ → repo root
    if (Test-Path (Join-Path $candidate '.git')) { $repoRoot = $candidate }
}
if (-not $repoRoot) {
    $repoRoot = git rev-parse --show-toplevel 2>$null
    if (-not $repoRoot) {
        Write-Error 'Could not determine repository root.'
        exit 1
    }
}
$repoRoot = (Resolve-Path $repoRoot).Path

$indexPath = Join-Path $repoRoot 'html' 'index.html'
$sriPath   = Join-Path $repoRoot 'sri-hashes.txt'

# ── SRI-protected file list ────────────────────────────────────────
# RelPath is relative to html/.  InSriTxt flags the 3 custom files
# that are also tracked in sri-hashes.txt.  SriTxtKey is the label
# used on each line of that file (e.g. "main.js: sha384-...").
$sriFiles = @(
    @{ RelPath = 'css/bootstrap.min.css';      InSriTxt = $false; SriTxtKey = ''                }
    @{ RelPath = 'css/all.min.css';            InSriTxt = $false; SriTxtKey = ''                }
    @{ RelPath = 'css/main.css';               InSriTxt = $true;  SriTxtKey = 'main.css'        }
    @{ RelPath = 'css/bs4-compat.css';         InSriTxt = $true;  SriTxtKey = 'bs4-compat.css'  }
    @{ RelPath = 'js/jquery-2.1.3.min.js';     InSriTxt = $false; SriTxtKey = ''                }
    @{ RelPath = 'js/jquery-ui.min.js';        InSriTxt = $false; SriTxtKey = ''                }
    @{ RelPath = 'js/bootstrap.bundle.min.js'; InSriTxt = $false; SriTxtKey = ''                }
    @{ RelPath = 'js/main.js';                 InSriTxt = $true;  SriTxtKey = 'main.js'         }
)

# ── Helper: compute SHA-384 SRI hash ──────────────────────────────
function Get-SriHash([string]$FilePath) {
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $sha   = [System.Security.Cryptography.SHA384]::Create()
    $hash  = $sha.ComputeHash($bytes)
    return 'sha384-' + [Convert]::ToBase64String($hash)
}

# ── Helper: extract current hash for a file from index.html ───────
# Looks for patterns like:
#   href="css/main.css" ... integrity="sha384-XXXX"
#   src: 'js/main.js',  ... integrity: 'sha384-XXXX'
# and returns the first sha384 value found for that relative path.
function Get-CurrentHash([string]$Content, [string]$RelPath) {
    $escaped = [regex]::Escape($RelPath)
    # Match the file path followed (within 200 chars) by a sha384 hash
    $pattern = "${escaped}[\s\S]{0,200}?sha384-[A-Za-z0-9+/=]+"
    $m = [regex]::Match($Content, $pattern)
    if ($m.Success) {
        $hashMatch = [regex]::Match($m.Value, 'sha384-[A-Za-z0-9+/=]+')
        if ($hashMatch.Success) { return $hashMatch.Value }
    }
    return $null
}

# ── Main logic ─────────────────────────────────────────────────────
if (-not (Test-Path $indexPath)) {
    Write-Error "index.html not found at $indexPath"
    exit 1
}

$indexContent   = [System.IO.File]::ReadAllText($indexPath)
$sriTxtContent  = if (Test-Path $sriPath) { [System.IO.File]::ReadAllText($sriPath) } else { '' }
$indexChanged   = $false
$sriTxtChanged  = $false
$filesFixed     = @()

foreach ($entry in $sriFiles) {
    $fullPath = Join-Path $repoRoot 'html' ($entry.RelPath -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $fullPath)) {
        Write-Warning "SRI-protected file not found, skipping: $($entry.RelPath)"
        continue
    }

    $newHash = Get-SriHash $fullPath
    $oldHash = Get-CurrentHash $indexContent $entry.RelPath

    if (-not $oldHash) {
        Write-Warning "Could not find existing hash for $($entry.RelPath) in index.html"
        continue
    }

    # ── Update index.html (global replace — the old hash appears 2-3 times) ──
    if ($oldHash -ne $newHash) {
        $indexContent = $indexContent.Replace($oldHash, $newHash)
        $indexChanged = $true
        $filesFixed  += $entry.RelPath
        Write-Host "  FIXED  $($entry.RelPath)"
        Write-Host "         old: $oldHash"
        Write-Host "         new: $newHash"
    }

    # ── Update sri-hashes.txt (only for custom files) ──
    if ($entry.InSriTxt -and $sriTxtContent) {
        $key = $entry.SriTxtKey
        $linePattern = "(?m)^${key}:\s*sha384-[A-Za-z0-9+/=]+"
        $replacement = "${key}: $newHash"
        $updated = [regex]::Replace($sriTxtContent, $linePattern, $replacement)
        if ($updated -ne $sriTxtContent) {
            $sriTxtContent = $updated
            $sriTxtChanged = $true
        }
    }
}

# ── Write changes & stage ──────────────────────────────────────────
$stagedFiles = @()

if ($indexChanged) {
    [System.IO.File]::WriteAllText($indexPath, $indexContent)
    $stagedFiles += $indexPath
}
if ($sriTxtChanged) {
    [System.IO.File]::WriteAllText($sriPath, $sriTxtContent)
    $stagedFiles += $sriPath
}

if ($stagedFiles.Count -gt 0 -and -not $NoStage) {
    foreach ($f in $stagedFiles) {
        git add $f 2>$null
    }
}

if ($filesFixed.Count -gt 0) {
    Write-Host "`nSRI hashes updated for: $($filesFixed -join ', ')"
    Write-Host "Updated files have been staged for this commit."
} else {
    Write-Host "SRI hashes: all OK"
}

exit 0
