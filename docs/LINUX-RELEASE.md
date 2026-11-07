# Canvas Cloud 0.2.0 — Linux x64 alpha

This Linux edition provides the same local-first editor as the existing Canvas Cloud 0.2.0 release. It is an alpha, with the compatibility and feature limitations documented in this repository. Back up important work using the app's native format.

## Downloads

- **AppImage:** portable x86-64 package. Make it executable with `chmod +x` and launch it. If FUSE is unavailable, use `--appimage-extract-and-run`.
- **Debian package:** install the downloaded `.deb` with `sudo apt install ./<downloaded-file>.deb`. Remove with `sudo apt remove canvas-cloud`.
- **SHA256SUMS-linux-x64.txt:** verify the downloaded files with `sha256sum --check SHA256SUMS-linux-x64.txt` from the download directory.

The build baseline is Ubuntu 22.04 x86-64 (glibc 2.35 and WebKitGTK 4.1). Debian packages declare their runtime dependencies. Older distributions and ARM devices are not supported by these downloads. Broader distribution compatibility is not yet validated.

## Validation and limits

The Linux release workflow runs frontend tests, a production build, Rust tests, Debian installation and removal, and 15-second startup checks for the installed application and extracted AppImage under Xvfb. It verifies uploaded asset sizes and SHA-256 digests, then checks unauthenticated public downloads after publication. Consult the linked workflow run for the actual results.

A startup check does not establish complete editor or native-dialog correctness. Interactive Linux file-dialog round trips, printing, desktop integration, Wayland behavior, accessibility and clean-machine data retention still require manual validation. File-association metadata does not establish opening files from the shell. Standalone packages have no publisher signature. Launcher-managed automatic updates require publication in the signed Linux release channel; publishing packages alone does not activate that channel.

## Rebuilding

Install the Tauri v2 Linux prerequisites, Node.js 24 and stable Rust. Then run:

```sh
npm ci
npm test
npx tauri build --bundles deb,appimage
cargo test --manifest-path src-tauri/Cargo.toml --locked -j 1
```

The workflow builds a Linux release only for the matching `linux-v0.2.0` tag in `sadiqgarba2553/canvas-cloud`. Existing Windows releases and launcher metadata are preserved.
