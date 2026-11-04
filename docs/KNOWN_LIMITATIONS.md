> Codex review (4 November 2026): Read [CODEX_VERIFICATION.md](CODEX_VERIFICATION.md) for tested behavior, corrected claims and remaining limits. Earlier source-only claims are not proof of feature parity.

# Canvas Cloud Known Limitations

This document tracks technical limitations, service dependencies, and verified boundaries.

1. **Storage Limits**:
   - IndexedDB storage is subject to browser/WebView quota limits (typically a few gigabytes per origin, but can be cleared by aggressive OS/browser cleanup). Users should periodically export `.canvascloud` backup files.
   - Max node limit per board is set to 10,000 objects in `validateBoard` to prevent DOM exhaustion in the SVG renderer.

2. **Rendering Performance**:
   - Canvas Cloud utilizes standard DOM SVG rendering (`<svg>` and `<g>` elements). While smooth for boards under 2,000 shapes, boards with over 5,000 complex freehand strokes may experience frame drops on low-end hardware. Spatial viewport culling or Canvas2D/WebGL rendering is documented for future high-density updates.

3. **Multiplayer & Collaboration**:
   - Canvas Cloud operates local-first. There is no remote WebRTC or WebSocket server enabled by default; comments and versions are stored locally on the current device. Shared editing is supported via exporting and importing `.canvascloud` files.

4. **External Media & PDF Importing**:
   - Raster images (PNG, JPEG, WebP) are stored as inline Base64 data within `.canvascloud` files up to 25 MB per board. Multi-page PDF import and video embeds are not yet connected into the native canvas renderer.

5. **Ink Smoothing & Hardware Pressure**:
   - Pen strokes capture pointer events with coordinate interpolation. Pointer pressure (stylus) is captured when supported by hardware, but bezier curve smoothing is currently linear.
