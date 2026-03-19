Added .sub to the accept attribute on both demo file picker inputs in index.html:

Line 428 — #pkg-input-demofiles (library packaging flow)
Line 2048 — #ulib-input-demofiles (edit & repack flow)


Explored codebase to understand import functionality
Created 5 todos
Explore: Explore import flows and UI structure
Explore: Read drag-drop and import code details
Read content.txt, lines 1 to 500

Now let me read the rest of _unifiedImportRoute and understand the batch import flow:

Reviewed 2 files
Now let me look at the batch import modal HTML and how it displays the library list:

Searched for batchImportModal and reviewed index.html
Now let me understand the batch import confirm phase to see how the package list is displayed:

Reviewed main.js lines 15290 to 15510
Now I have a clear picture. Let me look at where to add the overlay in the HTML and find the CSS location to add styles:

Searched for container-fluid p-0 and reviewed index.html
Now let me check where the CSS file ends and find the right places for additions:

Reviewed main.css and checked lines 6555 to 6572
Now let me also check the line count and end of main.js, and find the end of the batch import styles in main.css:

Searched for unified-import-drop-zone and reviewed main.css
Now I have all the context needed. Let me implement the drag-and-drop feature. Here's my plan:

HTML: Add a full-window drag-drop overlay inside .container-fluid
dragenter — detects file drags (ignoring text/element drags) and shows the overlay
dragleave — uses a counter pattern to handle nested element boundaries, hides overlay when drag exits the window
drop — collects dropped files, filters to supported extensions (.hxlibpkg, .hxlibarch, .pkg, .hampackage), then routes through _unifiedImportRoute() which already handles all the import flows:
Single .hxlibpkg → existing single-file preview (impLoadAndInstall)
Single .hxlibarch → archive flow with library list preview (impArchImportArchive)
Multiple files → batch import flow with scanning, confirmation list showing all libraries, duplicate detection, and COM DLL pre-scan (impBatchImportPackages)
Unsupported file types show a warning alert

