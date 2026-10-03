# Integrated local images and animations

The local model library offers **Stable Diffusion 1.5 Q4** and **AnimateDiff v3**.
Clicking Download prepares the model and a private diffusion engine automatically.
ComfyUI, a Python environment and a separately running image server are not required.
The existing Ollama / LM Studio conversation model remains separate from the image
and video selections. These runtimes themselves are not used to generate media.

Assets live in the application's `local-media` data directory. Download progress and
cancellation are exposed through the same event channel used by the library.
Downloads are pinned to immutable revisions and checked against exact sizes and
SHA-256 digests before activation. ZIP extraction rejects traversal and symlinks.
The engine executes with argument arrays, not shell interpolation, and processes
are terminated on cancellation or timeout. Generated files are validated and stored
as local references in the media directory rather than embedded in chat history.

Current defaults: images at 512×512; animations at 384×384 with eight frames at
eight frames per second (approximately one second, no audio). This is a lightweight
starting point, not a replacement for long-form video models. Model files total
about 1.57 GB for images, or 2.40 GB for images plus animations, excluding the engine.
Hardware and driver support affect performance. CPU execution can be much slower.

The first hardware smoke test was performed on Linux x86-64 with a Radeon RX 9060:
real PNG and WebM generation, image-to-video, cancellation and a spaced working
directory. Windows binaries are configured but have not been tested on Windows.
Automatic runtime download is not enabled for other platforms yet. LM Studio's
chat server is still required for LM Studio conversation models, but not for these
managed image/video models.

## Third-party components and model terms

- [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp), MIT license.
  Its release archive retains the bundled license and notices in the private runtime.
  Pinned release: `master-929-3f8527a`.
- [Stable Diffusion v1.5 GGUF](https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF),
  CreativeML Open RAIL-M model license. The model's use restrictions still apply;
  Vareliox's Apache-2.0 code license does not replace the model license.
- [AnimateDiff motion module](https://huggingface.co/conrevo/AnimateDiff-A1111) and
  [upstream AnimateDiff](https://github.com/guoyww/AnimateDiff). Consult the model
  repository and upstream terms, including the underlying Stable Diffusion license.

The engine and weights are downloaded on demand, not included in installers.

## Selecting and removing models

Choose Image or Video in the chat's + menu, then select its model in the composer.
You can start with an empty prompt and describe the result afterwards. A conversation
model or external local server is not required for the integrated diffusion engine.
Switching media providers does not replace the active conversation provider.

The local library has Download and Installed views. Removing a model requires
confirmation and clears matching selections in the current settings scope.
Chats and generated media are preserved. Stable Diffusion weights are shared with
AnimateDiff: removing the image model disables its entry, retaining those weights
while the video model still needs them. Removing both frees their weight files.
The small shared runtime is retained for later downloads.

Ollama deletion uses its loopback API. LM Studio enumeration uses its local CLI;
regular model files can be deleted only inside the configured models directory,
without symlinks or traversal. Loaded models must first be unloaded in LM Studio.
Multi-file LM Studio formats must currently be removed in LM Studio itself.

## Hardware integration test

The opt-in Rust test expects a private directory containing the verified assets
`vulkan.zip`, `sd15.gguf` and `motion.safetensors`. It verifies their hashes, prepares
a temporary installation, runs the production inference code and tests cancellation.
It never reads API keys or writes user chats. Successful tests leave only the small
`backend-dog.png` and `backend-animation.webm` QA outputs in the supplied directory.
Installed cache filenames are also accepted. Set `VARELIOX_MEDIA_TEST_OUTPUT` to a
separate QA directory to avoid writing test outputs alongside the installed assets.

```bash
VARELIOX_MEDIA_TEST_ASSETS=/absolute/private/test-assets \
  cargo test --manifest-path src-tauri/Cargo.toml \
  live_engine_download_install_image_video_and_cancellation -- --ignored --nocapture
```
