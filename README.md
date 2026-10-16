<p align="center">
  <img src="assets/icon.svg" width="120" height="120" alt="Slowed Reverb Audio icon" />
</p>
<h1 align="center">Slowed Reverb Audio</h1>
<p align="center"><strong>Slow YouTube audio and add built-in reverb — entirely in the browser.</strong></p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/nathwn12/slowed-reverb-audio" alt="License" /></a>
  <img src="https://img.shields.io/github/languages/top/nathwn12/slowed-reverb-audio" alt="Language" />
  <img src="https://img.shields.io/badge/platform-chrome--brave-2b3137?logo=googlechrome&logoColor=white" alt="Platform" />
</p>

## Project name and description

**Slowed Reverb Audio** (v1.0.2, Manifest V3) is a Chromium extension for slowed-and-reverb listening on YouTube and YouTube Music. It slows page audio from 0.7x to 1.3x without pitch distortion and adds a built-in Dattorro plate reverb, so all processing happens locally in the browser — no uploads, accounts, or servers. Per-site speed, reverb intensity, and Active state persist across restart and refresh, and auto-apply on first play. For anyone who wants a slowed-plus-reverb mode YouTube does not ship, in Chrome or Brave (Chromium only, no Firefox).

## Technology stack

- Vanilla JavaScript (ES2020), Manifest V3 extension — no framework, no build step, no TypeScript.
- Web Audio: `captureStream` → `AudioContext` + Dattorro plate reverb `AudioWorkletProcessor` (`dattorro-worklet.js`).
- Extension APIs: `scripting`, `storage`, `tabs` permissions; host permissions limited to `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com` (see Architecture for the `m.youtube.com` caveat).
- Dev-only: Node.js LTS + npm for `npm run lint` (eslint flat config `eslint.config.mjs`).

## Architecture

```text
popup.html / popup.js ──► chrome.storage.local ──► siteSettings, siteToggles
background.js (service worker) ── rehydrates eligible tabs, per-tab bypass (in-memory)
content-script.js + shared.js (ISOLATED world, document_start)
        │ window.postMessage with __slra: true
page-hook.js (MAIN world via chrome.scripting.executeScript)
dattorro-worklet.js (AudioWorkletProcessor, via chrome.runtime.getURL + audioWorklet.addModule)
```

Audio pipeline: `media.captureStream()` → `createMediaStreamSource()` → dry gain + Dattorro worklet → master gain → `destination`. While the graph is attached the element is muted (`media.muted = controller.attached`) to prevent double audio, and restored on teardown; the reverb tank stays primed even at neutral settings (`slow=1`, `intensity=0`) so raising the slider is instant. A 2s rate watchdog corrects playback-rate drift >0.02, and redundant MAIN/ISOLATED listeners plus a debounced `MutationObserver` survive YouTube SPA navigation. The content script is idempotent via a `globalThis` sentinel.

> [!NOTE]
> `m.youtube.com` is in `manifest.json` host permissions and content-script matches, but is NOT in `shared.js` `SUPPORTED_HOSTS` — the script loads and processing stays bypassed. Mobile YouTube has a different DOM; do not add it without testing.

## Getting started

Prerequisites: Chrome or Brave (desktop) with Developer mode access. No build step — the extension runs from source.

1. Download or clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repo root (the folder containing `manifest.json`).
5. Visit YouTube or YouTube Music, start a video, and click the extension icon.

## Project structure

```text
manifest.json            MV3 manifest (v1.0.2; scripting/storage/tabs; YouTube hosts; popup.html)
background.js            service worker (storage, tab coordination, script injection)
content-script.js        ISOLATED-world audio graph, rate watchdog, SPA handling
shared.js                shared helpers (SUPPORTED_HOSTS, clamps, formatters, storage)
page-hook.js             MAIN-world lifecycle signals via postMessage (__slra)
popup.html / popup.js    dark popup (speed + reverb sliders, Active toggle, reset, status)
dattorro-worklet.js      Dattorro plate reverb AudioWorkletProcessor
audio/icon-*.png         toolbar/store raster icons (16/32/48/128)
assets/icon.svg          house tile mark (README header)
PRIVACY_POLICY.md        data-handling statement
STORE_SUBMISSION.md      Web Store submission checklist
CHANGELOG.md             release history (Keep a Changelog)
```

## Key features

- Pitch-safe slowdown from 0.7x to 1.3x (0.01 step) on YouTube and YouTube Music.
- Built-in Dattorro plate reverb with adjustable intensity (0–100%).
- Per-site speed, intensity, and Active state persist across restart and refresh, auto-applying on first play.
- Dark popup with speed and reverb sliders, an Active toggle, reset, and a live tab-status indicator.
- Fully local processing — no audio leaves the browser.

## Development workflow

- `main` stays stable; do all work on a dedicated feature branch, never on `main`.
- Source change? Edit the root `*.js` directly — no bundler; reload the unpacked extension to test.
- Lint before pushing: `npm install` once, then `npm run lint` (expect 0 errors, 0 warnings).
- Record user-facing changes in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog, SemVer).
- Keep the popup control set fixed (speed slider, reverb slider, Active toggle, reset) — do not add controls.
- Keep the MV3 surface minimal: no new permissions or host patterns without a manifest-verified reason.

## Coding standards

- Vanilla ES2020, no TypeScript, no build; files at the repo root are the source.
- `shared.js` holds the shared helpers (host allowlist, `clampSlow`/`clampIntensity`, formatters); popup, worker, and content script consume it.
- `content-script.js` stays idempotent via its `globalThis` sentinel — never break the double-injection guard.
- The worklet is a faithful Dattorro (1997) implementation including the ±8-sample modulation LFO shimmer — do not "simplify" it away.
- `mozPreservesPitch`/`webkitPreservesPitch` aliases are Chromium-exposed and read by YouTube's player — do not remove them.

## Testing

- `npm run lint` — eslint flat config; expect 0 errors, 0 warnings.
- `node --check <file>.js` — syntax check per script (no build step exists).
- Browser QA scripts under `qa/` (untracked, local-only) are user-invoked only.

> [!CAUTION]
> Never play audio in a test. Verify audio paths silently: static checks plus offline numeric analysis of captured buffers in Node (stub `AudioWorkletProcessor` / `registerProcessor` / `sampleRate`, never connect to a destination or device). If a browser audio check seems unavoidable, stop and get explicit approval first.

## Contributing

Small, focused PRs from a feature branch; keep the unpacked-load flow working, keep `npm run lint` clean, and add a [CHANGELOG.md](CHANGELOG.md) entry for user-facing changes. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) and [STORE_SUBMISSION.md](STORE_SUBMISSION.md) for the store-facing constraints.

## Credits

The built-in reverb implements the plate algorithm from Jon Dattorro's "Effect Design, Part 1: Reverberator and Other Filters" (1997); delay constants follow the paper. This project is not affiliated with the author.

## License

MIT — see [LICENSE](LICENSE).

<!-- nathwn12 house footer: identical in every repo. Do not edit. -->
<p align="center">
  <a href="https://github.com/nathwn12"><img src="assets/signature.svg" width="96" alt="nathwn12" /></a>
</p>
<p align="center">
  <sub>Built by <a href="https://github.com/nathwn12">nathwn12</a> · <a href="https://github.com/nathwn12?tab=repositories">All projects</a></sub>
</p>
