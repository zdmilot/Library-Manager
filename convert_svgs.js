const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const glob = require('path');

(async () => {
    const imgDir = path.join(__dirname, 'CHM Help Source Files', 'images');
    const svgFiles = fs.readdirSync(imgDir).filter(f => f.startsWith('diagram-') && f.endsWith('.svg')).sort();

    console.log(`Found ${svgFiles.length} SVG files to convert`);

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    for (const svgFile of svgFiles) {
        const svgPath = path.join(imgDir, svgFile);
        const pngPath = svgPath.replace('.svg', '.png');
        const svgContent = fs.readFileSync(svgPath, 'utf-8');

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });

            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  body { background: white; width: 1200px; }
  svg { width: 1200px; height: auto; display: block; }
</style></head>
<body>${svgContent}</body></html>`;

            await page.setContent(html, { waitUntil: 'networkidle0' });

            // Get the bounding box of the SVG element
            const svgEl = await page.$('svg');
            if (!svgEl) {
                console.log(`FAIL: ${svgFile} - no SVG element found`);
                await page.close();
                continue;
            }

            const box = await svgEl.boundingBox();
            if (!box || box.width === 0 || box.height === 0) {
                console.log(`FAIL: ${svgFile} - zero-size bounding box`);
                await page.close();
                continue;
            }

            await svgEl.screenshot({ path: pngPath, type: 'png' });
            const stat = fs.statSync(pngPath);
            console.log(`OK: ${svgFile} -> ${path.basename(pngPath)} (${stat.size} bytes, ${Math.round(box.width)}x${Math.round(box.height)})`);
            await page.close();
        } catch (e) {
            console.log(`FAIL: ${svgFile} - ${e.message}`);
        }
    }

    await browser.close();
    console.log('\nDone');
})();
