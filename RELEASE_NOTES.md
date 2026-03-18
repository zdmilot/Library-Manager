# Changelog

<!--
  Edit this file with the release notes for the next version BEFORE
  triggering the "Build and Release" workflow.

  Use standard Markdown: headings, bullet lists, code fences, etc.
  Everything between the "Changelog" heading and the end of the file
  will appear as the GitHub Release body.

  After a successful release, this file is automatically reset to this
  template so it is ready for the next release cycle.
-->
Library Manager Changes
installer.iss: Added icacls grant for C:\Program Files (x86)\HAMILTON\Bin during install (best-effort, checks if folder exists first)
cli.js: Added ensureBinFolderPermissions() helper, called before bin file extraction in installPackage()
html/js/main.js: Same ensureBinFolderPermissions() helper, called in both the import confirm handler and the rollback flow
SRI hashes: Updated in both html/index.html and sri-hashes.txt for