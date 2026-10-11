<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="Slowed Reverb Audio icon" />
</p>
<h1 align="center">Slowed Reverb Audio</h1>
<p align="center"><strong>Slow YouTube audio and add local reverb, entirely in the browser.</strong></p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/nathwn12/slowed-reverb-audio" alt="License" /></a>
  <img src="https://img.shields.io/github/languages/top/nathwn12/slowed-reverb-audio" alt="Language" />
  <img src="https://img.shields.io/badge/platform-chrome--brave-2b3137?logo=googlechrome&logoColor=white" alt="Platform" />
  <a href="https://github.com/nathwn12/slowed-reverb-audio/actions/workflows/ci.yml"><img src="https://github.com/nathwn12/slowed-reverb-audio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

## What it is

Slowed Reverb Audio is a Chrome extension for slowed-and-reverb listening on YouTube and YouTube Music. It slows page audio from 0.7x to 1.3x without pitch distortion and adds a built-in Dattorro plate reverb, implemented as an `AudioWorkletProcessor` in `dattorro-worklet.js`, so all processing happens locally in the browser. Per-site speed, reverb intensity, and Active state persist in `chrome.storage.local`, survive restart and refresh, and auto-apply on first play.

## Why

YouTube has no built-in slowed-plus-reverb listening mode, so this extension adds one locally, with no uploads, accounts, or servers involved.

## Features

- Slow YouTube audio from 0.7x to 1.3x without pitch distortion
- Dattorro plate reverb with adjustable intensity (0-100%)
- Per-site settings persist across restart and refresh, and auto-apply on first play
- Works on YouTube and YouTube Music
- All audio processing stays local in the browser
- Dark popup UI with speed and reverb sliders plus an Active toggle

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or Brave.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.

## Usage

1. Visit YouTube or YouTube Music and start a video.
2. Click the extension icon to open the popup.
3. Drag the speed slider (0.7x-1.3x) and the reverb slider (0-100%).
4. Toggle **Active** to enable or disable processing.

## Build from source

Prerequisites: Node.js LTS and npm.

```powershell
git clone https://github.com/nathwn12/slowed-reverb-audio.git
cd slowed-reverb-audio
npm install
npm run lint
```

Then load the folder unpacked via `chrome://extensions` as above. There is no build step; the extension runs from source.

## Docs

- [PRIVACY_POLICY.md](PRIVACY_POLICY.md) - what the extension stores and why
- [STORE_SUBMISSION.md](STORE_SUBMISSION.md) - store listing checklist

## Status

**Unverified** — as-is, use at your own risk. Store listing review is unverified.

## License

MIT — see [LICENSE](LICENSE).

<!-- nathwn12 house footer: identical in every repo. Do not edit. -->
<p align="center">
  <a href="https://github.com/nathwn12"><img src="assets/signature.svg" width="96" alt="nathwn12" /></a>
</p>
<p align="center">
  <sub>Built by <a href="https://github.com/nathwn12">nathwn12</a> · <a href="https://github.com/nathwn12?tab=repositories">All projects</a></sub>
</p>
