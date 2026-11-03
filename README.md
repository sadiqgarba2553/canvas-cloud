# Canvas Cloud

A local-first infinite whiteboard by BlueCloud AI Technologies. Initial alpha, version 0.1.0.

## What works

- Multiple named boards, stored in IndexedDB on this device.
- Sticky notes, rectangles, ellipses, diamonds, text, freehand ink, and PNG/JPEG/WebP images.
- Shape connectors that follow moved or resized objects.
- Selection, moving, resizing, colors, text editing, stacking order, duplication, and deletion.
- Pan, zoom, fit-to-content, keyboard shortcuts, undo and redo.
- Portable `.canvascloud` JSON board files and standalone SVG export.
- Native open/save dialogs and atomic file saves in the Tauri desktop build.
- Original engraved purple squircle logo, matching the BlueCloud office family.

No account or network service is required. Boards are kept in the application’s local webview storage. Save a board file for backup and transfer; clearing browser/app storage removes local boards. The browser preview and native application have separate storage.

## Development

```powershell
npm ci
npm test
npm run dev
```

Preview: http://127.0.0.1:1441/

```powershell
npm run build
npm run desktop
```

## Windows build

Use Rust, the Microsoft C++ build tools, WebView2, and the Tauri prerequisites. On memory-constrained machines, limit compiler concurrency:

```powershell
$env:CARGO_BUILD_JOBS='1'
npm run desktop:build
```

The Windows installer is generated under `src-tauri/target/release/bundle/nsis/`. This alpha has no code-signing certificate or automatic update feed. It is not published to the launcher yet.

## Scope

This is a focused whiteboard, with its own implementation and branding. It does not claim feature parity with Freeform or Microsoft Whiteboard. Multiplayer collaboration, cloud synchronization, touch gestures beyond tool-based panning/drawing, grouping, PDF export, and file-association launch handling are not part of this version.

Board imports validate types, geometry, embedded image formats, and connector anchors. Images are embedded in the board file; import limits are 10 MB per image and 50 MB per board. No imported HTML or scripts are executed.

See `branding/LOGO.md` for the original logo generation prompt and asset provenance.
