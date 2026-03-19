Critical: missing libName variable

The var libName = $("#pkg-library-name").val().trim() || "Unknown" declaration in pkgCreatePackageFile was accidentally deleted when the deviceCompat block was inserted, replacing it instead of being added alongside it. Every package created via GUI would have undefined as its library name.

Incomplete: device_compatibility feature

The feature was half-wired — UI checkboxes and HTML placeholder sections existed, but:

deviceCompat was computed but never added to the manifest object
No code to load checkboxes when editing/re-packing a package (3 load paths)
No code to reset checkboxes on form reset
No JS to populate the display sections in lib-detail, import-preview, or store-detail views
