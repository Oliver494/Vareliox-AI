# Manual QA matrix

Record the application version, operating-system version, provider version, model, result, and diagnostic shown.

## Installation and projects

- Install and uninstall on clean Windows 11 and Kali Linux virtual machines.
- On Kali, test both the `.deb` and AppImage, the system folder picker, Secret Service key storage, Ollama, agent commands, and update downloads.
- Open paths containing spaces, accents, long names, and read-only files.
- Open a large repository and confirm the UI remains responsive.
- Open Hardware and verify CPU, RAM, storage, optional GPU/VRAM, and model-fit ratings.
- Confirm `.git`, `node_modules`, build output, symlinks, and `.gitignore` entries are excluded.
- Attempt `..`, absolute paths, reserved Windows names, and symlink escapes.

## Providers

For every provider: valid configuration, invalid key, invalid endpoint, unavailable model, timeout, interrupted stream, oversized context, cancellation, and model refresh.

For Ollama and LM Studio: application missing, server stopped, no model loaded, model download interrupted, and offline operation.

Paid API smoke tests must use a small prompt and a dedicated low-limit key. Never use production credentials in automated tests.

## Chat and agent

- Run simultaneous activity across two chats and verify state isolation.
- Switch project, view, model, and chat during streaming without accidental cancellation.
- Force-close Vareliox during a response and confirm the chat offers a retry after restart.
- Verify automatic context lists `file:start-end` references and final applied changes retain a diff.
- Paste supported and unsupported images.
- Review, reject, and apply create/write/rename/delete actions.
- Verify destructive actions require approval and cannot leave the project.
- Restore an agent recovery point and verify changed, created, renamed, and deleted files return to their earlier state.
- Open Doctor with and without a project/provider, then test a valid and an invalid connection.
- Stop tests/builds and confirm child processes terminate.
- Verify Git status/diff works outside a repository without hanging; verify commit and discard require confirmation, and that discarded changes appear in Recovery.

## Release

- Verify version, icon, installer, uninstall entry, first launch, update check, links, license, and acknowledgements.
- Scan the repository and installer with trusted security tools.
- Confirm no API key, local path, private project content, or credential appears in source, logs, screenshots, or release assets.
## Linux chat and managed media regression checks

The browser-only fixture uses the production ChatPane and ApprovalPicker with
mocked IPC. It cannot read desktop credentials or execute commands. Start the
development server with `npm run dev`, then run:

```bash
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-chat.html?theme=dark' 1280 720
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-chat.html?theme=light' 1366 768
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-chat.html?theme=dark' 1920 1080
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-chat.html?theme=light' 1280 720 - 1.25
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-chat.html?theme=dark' 1280 720 - 1.5
python3 scripts/check-chat-webkit.py 'http://127.0.0.1:1420/tests/visual-providers.html' 1280 720
```

These cases were verified on Linux WebKitGTK. They cover prompt visibility,
1/5/12/30-line compositor growth, outside-click/Escape dismissal, keyboard
permissions, the full-access warning shield, red Stop, cancellation recovery and
separate chat/media models. Optional fourth argument saves an offscreen screenshot.
The provider fixture also exercises Download -> model selection -> persistence,
including preservation of a different active conversation provider.

Real local image generation, text-to-video, image-to-video, runtime installation
from verified downloads, spaced paths and cancellation were tested separately
through the production Rust engine. See [LOCAL_MEDIA.md](LOCAL_MEDIA.md) for the
opt-in hardware test, model licenses and current limits. LM Studio's default URL
was checked against an installed LM Studio server on loopback port 1234.
Windows and macOS visual behavior has not been verified by these Linux checks.

### Media selection and model removal (2026-10-03)

The production picker now separates conversation, image and video capabilities.
The + tools can be selected before writing a prompt, including when no chat model
is configured. Local media listing does not depend on the LM Studio/Ollama chat
server. NVIDIA generation models use the adapter catalog, not its chat endpoint.

`tests/visual-media.html` exercises these cases with mocked IPC, including rendering
the successful result, preserving the chat model, and actionable missing-model errors.
Use `?provider=lm_studio`, `?provider=ollama&mode=video`, `?provider=gemini&theme=light`,
`?provider=open_ai`, or `?missing=true`. These are UI tests, not cloud API tests.
The provider fixture additionally tests cancellation and confirmation of deletion,
cleared media selection and preservation of an unrelated active cloud provider.
No actual user model was deleted during testing.

Run `bash scripts/test-visual-linux.sh` for the nine-case release regression suite.
It starts and stops its own Vite server and uses Xvfb when available, or the current
Linux display otherwise. The Linux release job runs this suite before uploading
installers; failed UI checks prevent publication.

`tests/visual-code-summary.html` uses the production Code interface and a mocked
stream to verify that project summaries remain visible and persisted after Done,
do not trigger action repairs, and do not block subsequent questions. It also
tests a repair timeout, rejected partial operations, and a successful JSON-only
repair that preserves the explanation and still requests approval. No real
provider credentials or project writes are used in this fixture.

Rust tests cover model path traversal, symlink rejection, unknown model IDs and
shared diffusion weight retention. The opt-in hardware test was rerun successfully
against the installed assets using a separate temporary installation: real image,
image-to-video, cancellation and cleanup all passed. Outputs are separate QA files.
