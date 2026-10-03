# Vareliox

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/vareliox-white.png">
    <source media="(prefers-color-scheme: light)" srcset="src/assets/vareliox-black.png">
    <img src="src/assets/vareliox-black.png" alt="Vareliox logo" width="360">
  </picture>
</p>

<p align="center">
  <strong>A local-first AI workspace for chat, code, images, and video that explains what is happening.</strong>
</p>

<p align="center">
  <a href="https://github.com/Oliver494/Vareliox-AI/releases/latest"><img src="https://img.shields.io/github/v/release/Oliver494/Vareliox-AI?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="https://github.com/Oliver494/Vareliox-AI/actions/workflows/ci.yml"><img src="https://github.com/Oliver494/Vareliox-AI/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 license"></a>
</p>

<p align="center">
  <a href="https://github.com/Oliver494/Vareliox-AI/releases/latest">Download for Windows or Linux</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Vareliox lets you open a real project folder, explore and edit its files, then work with local or cloud AI models. It is designed around a simple rule: **never leave the user staring at a spinner without knowing what failed or what happens next.**

There is no Vareliox account, hosted project copy, or required subscription. Bring your own local model or provider API key.

> **Early beta.** Make a backup or use Git before allowing an agent to edit important work. Vareliox always asks for approval unless you intentionally choose a broader permission mode.

## Highlights

- **Local AI first** — Ollama and LM Studio are first-class providers.
- **Cloud providers when you need them** — OpenAI, Anthropic, Google Gemini, NVIDIA API, Z.AI, Kimi, and custom OpenAI-compatible endpoints.
- **Real project workspace** — open multiple folders, browse files, edit with syntax highlighting, and save safely.
- **Agent mode with control** — review proposed changes, approve or reject actions, inspect diffs, and restore recent operations.
- **Clear diagnostics** — connection tests, timeouts, cancellation, provider-specific explanations, and recommended next steps.
- **Your data stays under your control** — API keys use the operating-system credential store; Vareliox does not put them in the repository or browser storage.
- **Made for everyday development** — chats per project, pinned conversations, search, image/file attachments, themes, and 12 interface languages.
- **Media inside the conversation** — select image/video tools from `+` without changing the conversation model, download results, or save them to an authorized project.
- **Managed local diffusion** — download Stable Diffusion 1.5 Q4 or AnimateDiff v3 together with their private runtime; manage installed models with confirmation before removal.
- **A clearer workspace** — resizable unified sidebar, an automatically growing composer, capability-specific model pickers, and a project explorer with open-file tabs and inline rename.

## Download and install

Download the package for your operating system from [Releases](https://github.com/Oliver494/Vareliox-AI/releases/latest):

- **Windows:** run the x64 `.exe` installer.
- **macOS (Apple Silicon or Intel):** source builds are available using the instructions below; this Windows/Linux release does not include a new macOS installer.
- **Kali Linux / Debian / Ubuntu:** download the x86_64 `.deb` and install it with `sudo apt install ./Vareliox*.deb` from its download folder.
- **Other x86_64 Linux distributions:** download the `.AppImage`, run `chmod +x ./Vareliox*.AppImage`, then open it with `./Vareliox*.AppImage`.

End users do **not** need Node.js, Rust, Git, Ollama, or LM Studio to install the app. Local conversation models need Ollama or LM Studio. The integrated diffusion models prepare their own engine and do not require a separate ComfyUI installation.

Windows may show a SmartScreen warning while the project does not yet have a trusted code-signing certificate. The macOS build is ad-hoc signed, so macOS can require approval in Privacy & Security until the project has an Apple Developer certificate and notarization. Linux packages are also currently unsigned. Always download packages from this repository's official Releases page.

## Quick start

1. Install Vareliox from [Releases](https://github.com/Oliver494/Vareliox-AI/releases/latest).
2. Create or open a project folder.
3. Choose **Vareliox Chat** for normal chat or **Vareliox Code** to work on a project.
4. Select a provider and use **Test connection** before chatting.
5. Choose a model and ask a question.
6. When the agent proposes file changes, inspect the diff and approve or reject it.

For local models, start Ollama or LM Studio first. Vareliox detects common problems such as an offline server, missing model, invalid endpoint, expired quota, timeout, or invalid API key.

## Providers

| Local | Cloud | Custom |
| --- | --- | --- |
| Ollama | OpenAI | OpenAI-compatible endpoints |
| LM Studio | Anthropic | Your endpoint, model, and API key |
|  | Google Gemini |  |
|  | NVIDIA API |  |
|  | Z.AI |  |
|  | Kimi |  |

Provider availability depends on your own installation, account, billing, model access, and network connection. Vareliox never includes provider API keys in source control.

## What Vareliox can do today

### Work with projects

- Open, remember, and switch between multiple project folders.
- Browse folder trees while respecting `.gitignore` and common generated/cache directories.
- Create, rename, edit, save, and delete project files and folders.
- Use tabs, syntax highlighting, line numbers, safe atomic saves, and file-type icons.
- Attach open files, uploaded files, and pasted images to a chat.

### Talk to models reliably

- Stream responses with real stop/cancel support.
- Set connection, first-response, inactivity, and maximum request timeouts.
- Test a provider before using it and get actionable diagnostics when it fails.
- Choose models directly from the chat and select reasoning effort when the provider supports it.
- Keep conversations separate by project and mode.

### Use the coding agent safely

- Let the model propose file creation, edits, renames, folders, and deletions.
- Review every proposed change in a diff before applying it.
- Use request-by-request approval, automatic approval for the task, or a deliberate full-access mode.
- Authorize an additional external folder as **read-only** or **editable**; the model cannot access it until you explicitly select it.
- Choose between a disabled terminal, allowlisted project tools, a normal user shell, or an administrator shell. Model-requested commands are shown before execution and their real output is returned to the model.
- Use CMD or PowerShell on Windows and Bash or Zsh on macOS and Linux. Administrator mode uses the current Vareliox process permissions and never reads a password.
- Keep file access project-only by default or deliberately authorize all filesystem roots. External changes always require review and Vareliox does not scan the full disk automatically.
- Recover recent agent file operations from local snapshots.

### Create images and short videos

- Choose Image or Video in `+` before writing a description, even without a conversation model configured.
- Select media models independently of the chat provider; the picker separates conversation, image and video.
- Supported adapters include OpenAI Images, compatible Gemini image models, supported NVIDIA generation endpoints, verified custom OpenAI Images endpoints, and the managed local engine.
- See generation progress, cancel, retry, download, and save results inside an authorized project.
- Keep generated files in application data, with references in history rather than full base64 images.
- Use the local library's Installed view to remove models with confirmation. Shared model weights, conversations and generated results are preserved when applicable.

Media capabilities depend on the specific adapter and account, not only the model name. Local generation is experimental: AnimateDiff creates short silent clips, Windows currently uses a CPU engine, and Linux uses an Ubuntu 24.04 x86_64 Vulkan build that requires compatible system libraries and drivers. Cloud APIs require your own credits, quota and model access. See [local media details](docs/LOCAL_MEDIA.md) and [QA coverage](docs/QA.md). Windows/macOS visual behavior has not been verified by the Linux checks.

## Security and privacy

Vareliox is intentionally conservative about file access and commands:

- Project-only mode rejects absolute paths, `..` traversal, unsafe platform-specific names, symlink traversal, ignored folders, shell operators, and unrestricted system commands.
- Full filesystem access and unrestricted shells are separate, explicit opt-ins. Commands run with the selected operating-system account and administrator commands always require approval.
- API keys are saved through the operating-system credential store and are not displayed after saving.
- Cloud providers receive only the messages, attachments, and project context included in the request.

Read [SECURITY.md](SECURITY.md) before enabling agent permissions and [PRIVACY.md](PRIVACY.md) for the data-handling details. To report a vulnerability, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Development

### Requirements

- Node.js 22 or newer
- Rust stable
- Windows: Microsoft C++ Build Tools and the WebView2 requirements for Tauri 2
- macOS: Xcode Command Line Tools
- Linux: WebKitGTK 4.1 and the native Tauri build dependencies listed below

### Run locally

```bash
npm install
npm run tauri dev
```

### Run checks

```bash
npm run check
```

### Build the Windows installer

```bash
npm run tauri -- build
```

### Build Linux packages (Kali / Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils
npm ci
npm run test:all
npm run build:linux
```

The generated packages are placed in `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`. On minimal Kali installations, install and start `gnome-keyring` so Vareliox can store API keys through the Linux Secret Service.

### Build the universal macOS installer

Run this on macOS with Xcode Command Line Tools installed:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run test:all
npm run build:macos
```

The universal `.dmg` is generated in `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. The same build is available as the manually triggered **Build macOS installer** GitHub Actions workflow.

See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/QA.md](docs/QA.md), and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more detail.

## Contributing

Issues, design feedback, documentation improvements, provider integrations, and code contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Project status

Vareliox is actively developed. Check [ROADMAP.md](ROADMAP.md) for planned work and [CHANGELOG.md](CHANGELOG.md) for released changes.

## Independence and trademarks

Vareliox is an independent project. It is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, Google, NVIDIA, Ollama, LM Studio, Z.AI, Kimi, or any other supported provider. Provider names and logos belong to their respective owners; see [TRADEMARKS.md](TRADEMARKS.md).

## License

Vareliox is licensed under the [Apache License 2.0](LICENSE).
