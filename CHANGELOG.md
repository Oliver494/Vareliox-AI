# Changelog

All notable changes will be documented here. The format follows Keep a Changelog and versions follow Semantic Versioning.

## [Unreleased]

## [0.1.12] - 2026-10-07

### Fixed

- Fixed Code summaries and project analyses being mistaken for file edits, triggering action-format retries that erased the response.
- Retained previous responses during operation repairs, rejected partial operations after repair errors, and stopped continuations from reviving unrelated older write requests.
- Isolated release build downloads from checked-in screenshots and verified all three versioned installer names before publication.

## [0.1.11] - 2026-10-03

### Added

- Image and video tools directly in Chat and Code, with separate provider/model selection, cancellation, downloads and authorized project saves.
- Managed local Stable Diffusion 1.5 Q4 and AnimateDiff v3 downloads that also prepare a private inference engine.
- Installed-model management with explicit deletion confirmation and shared-weight retention.
- Local media file references, legacy image migration and explicit orphan-file maintenance.
- Capability-aware catalogs, a custom image endpoint verification test and a local LM Studio server starter.
- Linux WebKitGTK UI regression fixtures for the composer, permissions, provider selection and model removal.

### Changed

- Unified resizable sidebar, Chat/Code navigation, project explorer, preferences and provider controls.
- Automatically growing composer, improved file tabs/tree, and consistent light/dark permission menus.
- Removed the separate Vareliox Create workspace while preserving existing settings and conversation data.

### Fixed

- Clipped user messages, low-contrast Stop controls and attachment menus that stayed open after outside clicks.
- Disabled media tools when the prompt was empty or no conversation model was configured.
- Media models missing from a conversation-only picker and NVIDIA's separate generation catalog.
- Image/video selection replacing the conversation model, and inconsistent default generation provider selection.
- Updated the TLS dependency to address RUSTSEC-2026-0285 and replaced a yanked cryptography dependency.
- Normalized paths in model-management regression tests for Windows and macOS. The 0.1.10 validation tag was not published as a release.

### Known limitations

- Local diffusion is experimental: image quality, generation time and available hardware vary. AnimateDiff produces short, silent clips.
- The managed engine is currently available for Linux x86_64 (Ubuntu 24.04 Vulkan build) and Windows x86_64 (CPU build), not macOS.
- Cloud generation requires the provider's model access, credits and quota; UI tests do not establish live API entitlement.
- Multi-file LM Studio formats must currently be removed through LM Studio itself.
- Windows/macOS visual behavior is not covered by the Linux visual checks. Installers are not certificate-signed.

## [0.1.7] - 2026-09-11

### Changed

- Rebranded the application, installer, executable, documentation, and platform icons as Vareliox.
- Added theme-aware Vareliox branding for light and dark interfaces.
- Renamed the three workspaces to Vareliox Chat, Vareliox Code, and Vareliox Create.
- Preserved existing internal storage and application identifiers so current projects, conversations, permissions, and provider settings remain compatible.

## [0.1.1] - 2026-09-08

### Added

- Multiple projects with stable alphabetical ordering.
- Twelve interface languages with translation coverage checks.
- Community, security, privacy, and trademark documentation.
- Doctor checks for the active project, model, credentials, and provider connection.
- Automatic recovery snapshots and a private metadata-only agent action log.
- A recovery screen that can restore recent agent file operations.
- Local CI, secret scanning, dependency updates, and Windows build workflows.
- First-run setup, interrupted-session recovery, visible context references, and persisted final diffs.
- Local Git inspection, confirmed commits, recoverable change discard, and hardware-aware local model recommendations.
- Lazy-loaded editor language support and large-project context tests.
- Per-conversation chat and coding-agent modes, with backend-enforced project isolation for normal chat.
- Kali/Debian Linux support with `.deb` and AppImage builds, native agent commands, GPU detection, system keyring storage, ComfyUI discovery, and platform-aware update downloads.

### Changed

- Compact project/file sidebar and improved language coverage.

## [0.1.0] - 2026

Initial early-beta foundation: project explorer/editor, provider connections, project chat, local model support, restricted agent actions, diagnostics, and update notifications.
