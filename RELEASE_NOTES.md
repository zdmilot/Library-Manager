# Release Notes

## v3.1.16

### New CLI Commands

- **`marketplace-search`** — Search and browse the online marketplace catalog directly from the command line. Supports filtering by keyword (`--query`), category (`--category`), author (`--author`), and tag (`--tag`). Outputs human-readable tables or JSON (`--json`) for scripting.

- **`marketplace-install`** — Download and install libraries from the marketplace catalog. Automatically resolves and installs dependencies in the correct order. Downloaded packages are SHA-256 verified against the catalog hash before installation. Supports version pinning (`--version`), forced reinstall (`--force`), and dependency skipping (`--no-deps`).

- **`show-lib`** — Display detailed information about a specific installed library, including all metadata, file lists, public functions, dependencies, device compatibility, installation paths, and integrity hashes. Supports `--json` output for scripting.

- **`search-libs`** — Search installed libraries by keyword, tag, or author. Searches across library name, author, organization, description, tags, and VENUS compatibility. Supports combined filters and `--json` output.

### Bug Fixes

- Fixed issues with registration and other minor bug fixes.
