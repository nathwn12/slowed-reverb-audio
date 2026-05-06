# Slowed Reverb Audio

Lightweight Chrome extension that slows YouTube audio and adds built-in reverb locally.

## What it does

- Slows YouTube audio from 0.7x to 1.3x without pitch distortion
- Adds Dattorro plate reverb with adjustable intensity
- Per-site settings with optional persistence
- Works with YouTube and YouTube Music

## Files

```
slowed-reverb-audio/
├── manifest.json          # Extension manifest v3
├── background.js          # Storage, injection, tab coordination
├── content-script.js      # Page injection controller
├── page-hook.js          # Audio processor injection
├── popup.html            # Controls UI (dark theme, sliders, toggles)
├── popup.js              # Popup logic
├── shared.js             # Cross-context helpers
├── dattorro-worklet.js  # Reverb DSP
├── audio/
│   └── icon-*.png        # Extension icons
└── README.md
```

## Load in Chrome/Brave

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Usage

1. Visit YouTube or YouTube Music
2. Click extension icon
3. Adjust speed slider (0.7x–1.3x)
4. Adjust reverb intensity (0–100%)
5. Toggle **Active** to enable/disable
6. Enable **Remember** to persist per-site settings

## Permissions

- `storage`: Remember per-site preferences
- `tabs`: Get current tab info for popup
- `scripting`: Inject audio processing into page context
- `host_permissions`: YouTube and YouTube Music only

## Privacy

All processing happens locally in the browser. No audio is uploaded or transmitted.
