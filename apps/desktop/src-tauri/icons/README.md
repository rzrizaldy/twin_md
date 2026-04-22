# icons

Generate platform icons from a single 1024×1024 PNG before running `tauri build`:

```bash
pnpm --filter @twin-md/desktop tauri icon path/to/source.png
```

This writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`,
and the tray `icon.png` into this directory. `tauri dev` can run without them
but `tauri build` requires the full set.
