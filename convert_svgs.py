"""Convert SVG diagrams to PNG using Puppeteer (via Node.js)."""
import os, glob, subprocess, re, tempfile

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
svg_dir = r'c:\Users\admin\Documents\GitHub\Library Manager\CHM Help Source Files\images'
svgs = sorted(glob.glob(os.path.join(svg_dir, 'diagram-*.svg')))

for svg_path in svgs:
    png_path = svg_path.replace('.svg', '.png')
    name = os.path.basename(svg_path)

    # Read SVG to get viewBox/width for sizing
    with open(svg_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Create a wrapper HTML that renders the SVG at a fixed size
    html_content = f'''<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * {{ margin: 0; padding: 0; }}
  body {{ background: white; display: inline-block; }}
  img {{ display: block; max-width: 1200px; height: auto; }}
</style></head>
<body><img src="file:///{svg_path.replace(os.sep, '/')}"></body></html>'''

    tmp_html = os.path.join(tempfile.gettempdir(), 'svg_convert.html')
    with open(tmp_html, 'w', encoding='utf-8') as f:
        f.write(html_content)

    try:
        result = subprocess.run([
            EDGE,
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
            '--force-device-scale-factor=2',
            f'--screenshot={png_path}',
            '--window-size=1200,2000',
            '--default-background-color=00000000',
            f'file:///{tmp_html.replace(os.sep, "/")}'
        ], capture_output=True, text=True, timeout=30)
        if os.path.exists(png_path) and os.path.getsize(png_path) > 0:
            print(f'OK: {name} -> {os.path.basename(png_path)} ({os.path.getsize(png_path)} bytes)')
        else:
            print(f'FAIL: {name} - no output ({result.stderr[:200]})')
    except Exception as e:
        print(f'FAIL: {name} - {e}')

print(f'\nProcessed {len(svgs)} files')
