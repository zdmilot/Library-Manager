/**
 * build_icons.js — High-quality icon generation pipeline
 * ========================================================
 * Uses sharp to render the SVG at maximum quality into multiple PNG sizes,
 * then builds a comprehensive multi-resolution ICO for the .exe,
 * and applies it with rcedit.
 *
 * Usage:  node build_icons.js
 *
 * Prerequisites (already in package.json):
 *   npm install sharp
 *   npm install --save-dev rcedit
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// ── Configuration ──────────────────────────────────────────────
const SVG_SOURCE = path.join(__dirname, "VenusLibraryManager.svg");
const ICONS_DIR = path.join(__dirname, "icons");
const OUTPUT_ICO = path.join(__dirname, "VenusLibraryManager.ico");
const OUTPUT_PNG = path.join(__dirname, "VenusLibraryManager.png");
const EXE_PATH = path.join(__dirname, "Library Manager.exe");

// Master render size — render SVG at this resolution first, then downscale.
// The SVG is 2000x2000; we render at 2x density to get a 4000px intermediate,
// then downscale to master size with lanczos3 for pristine results.
const MASTER_SIZE = 2048;

// ICO layer — single max-size entry (256×256 is the ICO format maximum).
// The directory entry uses a BYTE for width/height where 0 = 256,
// making 256×256 the largest dimension the format can represent.
// Windows renders this as the HD "jumbo" icon in Explorer, taskbar, etc.
const ICO_SIZES = [256];

// The PNG size used for the NW.js window icon (package.json "icon")
const WINDOW_ICON_SIZE = 1024;

// ── Helpers ────────────────────────────────────────────────────

/** Render SVG to a high-res PNG buffer using sharp */
async function renderSvgToMaster() {
  console.log(`\n[1/5] Rendering SVG → ${MASTER_SIZE}x${MASTER_SIZE} master PNG...`);

  const svgBuffer = fs.readFileSync(SVG_SOURCE);

  // Render at 2x density (144 DPI) for a high-quality intermediate,
  // then resize down to master size with lanczos3 for best downsampling.
  const masterBuffer = await sharp(svgBuffer, { density: 144 })
    .resize(MASTER_SIZE, MASTER_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 0 }) // lossless, no compression artifacts
    .toBuffer();

  console.log(`    Master buffer: ${(masterBuffer.length / 1024).toFixed(1)} KB`);
  return masterBuffer;
}

/** Generate the single 256×256 PNG for the ICO layer */
async function generatePngs(masterBuffer) {
  console.log(`\n[2/5] Generating ${ICO_SIZES.length} PNG size (${ICO_SIZES[0]}×${ICO_SIZES[0]})...`);

  // Ensure icons directory exists
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  const pngBuffers = {};

  for (const size of ICO_SIZES) {
    const pngBuffer = await sharp(masterBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    pngBuffers[size] = pngBuffer;

    const outPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
    fs.writeFileSync(outPath, pngBuffer);
    console.log(`    ${size}x${size}  ${(pngBuffer.length / 1024).toFixed(1)} KB  (32-bit RGBA)`);
  }

  return pngBuffers;
}

/** Generate the NW.js window icon PNG at high resolution */
async function generateWindowPng(masterBuffer) {
  console.log(`\n[3/5] Generating window icon PNG (${WINDOW_ICON_SIZE}x${WINDOW_ICON_SIZE})...`);

  await sharp(masterBuffer)
    .resize(WINDOW_ICON_SIZE, WINDOW_ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 6 })
    .toFile(OUTPUT_PNG);

  const stats = fs.statSync(OUTPUT_PNG);
  console.log(`    Saved: ${OUTPUT_PNG}`);
  console.log(`    Size:  ${(stats.size / 1024).toFixed(1)} KB`);
}

/**
 * Build a single-layer ICO file at the maximum dimensions (256×256).
 *
 * ICO format spec:
 * - Header: 6 bytes (reserved=0, type=1 for ICO, count=1)
 * - Directory entry: 16 bytes (width=0 means 256, height=0 means 256)
 * - Image data: PNG-compressed, 32-bit RGBA
 *
 * 256×256 is the maximum dimension the ICO directory entry can represent
 * (the width/height fields are single bytes where 0 = 256).
 * PNG compression (Vista+) gives lossless quality at full color depth.
 */
function buildIco(pngBuffers) {
  console.log(`\n[4/5] Building single-layer 256×256 ICO (max size, 32-bit RGBA)...`);

  const icoSizes = ICO_SIZES; // [256]
  const numImages = icoSizes.length;

  // ICO Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images

  // Directory entries: 16 bytes each
  const dirSize = numImages * 16;
  const directory = Buffer.alloc(dirSize);

  // Calculate data offset (after header + directory)
  let dataOffset = 6 + dirSize;

  // Collect PNG data buffers in order
  const imageDataBuffers = [];

  for (let i = 0; i < numImages; i++) {
    const size = icoSizes[i];
    const pngData = pngBuffers[size];

    const entryOffset = i * 16;

    // Width (0 means 256)
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 0);
    // Height (0 means 256)
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    // Color palette (0 = no palette)
    directory.writeUInt8(0, entryOffset + 2);
    // Reserved
    directory.writeUInt8(0, entryOffset + 3);
    // Color planes (1 for ICO)
    directory.writeUInt16LE(1, entryOffset + 4);
    // Bits per pixel (32 for RGBA)
    directory.writeUInt16LE(32, entryOffset + 6);
    // Size of image data
    directory.writeUInt32LE(pngData.length, entryOffset + 8);
    // Offset of image data from beginning of file
    directory.writeUInt32LE(dataOffset, entryOffset + 12);

    imageDataBuffers.push(pngData);
    dataOffset += pngData.length;
  }

  // Concatenate everything
  const icoBuffer = Buffer.concat([header, directory, ...imageDataBuffers]);

  fs.writeFileSync(OUTPUT_ICO, icoBuffer);
  const stats = fs.statSync(OUTPUT_ICO);
  console.log(`    Saved: ${OUTPUT_ICO}`);
  console.log(`    Size:  ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`    Layers: ${numImages}`);
  console.log(`    Sizes:  ${icoSizes.join(", ")}`);
  console.log(`    Format: PNG-compressed, 32-bit RGBA (Vista+ standard, maximum quality)`);
  console.log(`    Color:  32-bit (8 bits/channel × 4 channels = true color + alpha)`);
}

/** Apply the ICO to the .exe using rcedit */
async function applyToExe() {
  console.log(`\n[5/5] Applying ICO to .exe...`);

  if (!fs.existsSync(EXE_PATH)) {
    console.log(`    [SKIP] .exe not found: ${EXE_PATH}`);
    return;
  }

  if (!fs.existsSync(OUTPUT_ICO)) {
    console.log(`    [SKIP] ICO not found: ${OUTPUT_ICO}`);
    return;
  }

  try {
    const { rcedit } = require("rcedit");
    await rcedit(EXE_PATH, { icon: OUTPUT_ICO });
    console.log(`    Applied icon to: ${EXE_PATH}`);
    console.log(`    The .exe will now show the crisp, high-res icon in Explorer.`);
  } catch (err) {
    console.error(`    [ERROR] rcedit failed: ${err.message}`);
    console.log(`    You can manually apply with: npx rcedit "${EXE_PATH}" --icon "${OUTPUT_ICO}"`);
  }
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Venus Library Manager — Icon Build Pipeline       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nSource SVG:  ${SVG_SOURCE}`);
  console.log(`Master size: ${MASTER_SIZE}x${MASTER_SIZE}`);
  console.log(`ICO:         Single 256×256 layer (max ICO dimension, 32-bit RGBA)`);

  // Step 1: Render SVG at ultra-high resolution
  const masterBuffer = await renderSvgToMaster();

  // Step 2: Generate all PNG sizes
  const pngBuffers = await generatePngs(masterBuffer);

  // Step 3: Generate the NW.js window icon
  await generateWindowPng(masterBuffer);

  // Step 4: Build ICO with all sizes ≤256
  buildIco(pngBuffers);

  // Step 5: Apply to .exe
  await applyToExe();

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  DONE! All icons generated successfully.");
  console.log("══════════════════════════════════════════════════════");
  console.log(`\n  ICO file:     ${OUTPUT_ICO}  (256×256, 32-bit RGBA, PNG-compressed)`);
  console.log(`  Window PNG:   ${OUTPUT_PNG}`);
  console.log(`  Icon PNGs:    ${ICONS_DIR}/`);
  console.log("");
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err);
  process.exit(1);
});
