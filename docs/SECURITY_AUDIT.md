# Local security audit

Last local review: 2026-10-03 (Vareliox 0.1.11).

## Results

- Frontend secret scan: passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- RustSec `cargo audit`: no vulnerability failure; 7 dependency warnings.
- Updated `rustls` to 0.23.45 to address RUSTSEC-2026-0285, and replaced the yanked `chacha20` 0.10.1 with 0.10.2.
- Agent path traversal, symlink, ignored-folder, command allowlist, cancellation, rollback, and credential-redaction tests: passed.

## RustSec warnings

The lockfile contains a historical `glib` unsoundness warning for `VariantStrIter`. Vareliox does not call this API in its Rust source, but `glib` remains a transitive Linux desktop dependency. Review Tauri/WebKitGTK advisories before each Linux release and rebuild on the supported Ubuntu baseline.

Several `unic-*` crates and `proc-macro-error` are marked unmaintained. They are transitive dependencies under Tauri's dependency graph; Vareliox does not call them directly. They must be reviewed when upgrading Tauri and should not be silently ignored for future cross-platform builds.

This report is not a professional penetration test. A public release still needs a clean-machine installer test, code signing, and periodic dependency review.
