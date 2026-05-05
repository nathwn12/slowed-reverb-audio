(() => {
  const existing = globalThis.__slowedReverbAudioContent;
  if (existing?.refresh) {
    existing.refresh();
    return;
  }

  const {
    getCurvedWetAmount,
    getDefaultSettings,
    isNeutral,
    normalizeFlavor,
    normalizeSettings,
  } = globalThis.SlowedReverbShared;

  const state = {
    settings: getDefaultSettings(),
    bypass: false,
    eligible: false,
    media: new Map(),
    observer: null,
    scanQueued: false,
    recoveryQueued: false,
    hookRefreshQueued: false,
    context: null,
    presetBuffers: new Map(),
    listenersReady: false,
    lifecycleListenersReady: false,
    pageHookReady: false,
    lastError: '',
  };

  globalThis.__slowedReverbAudioContent = {
    refresh() {
      queueScan();
      void bootstrap(false);
    },
  };

  void bootstrap(true);

  async function bootstrap(ensureHooks) {
    ensureGlobalListeners();
    ensureLifecycleListeners();
    ensureObserver();
    if (ensureHooks) {
      void requestHookRefresh('bootstrap');
    }
    queueScan();

    try {
      const runtime = await chrome.runtime.sendMessage({ type: 'GET_TAB_RUNTIME_STATE' });
      applyRuntimeState(runtime);
    } catch {
      state.lastError = 'Runtime unavailable.';
      syncAllMedia();
    }
  }

  function ensureGlobalListeners() {
    if (state.listenersReady) return;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'SLRA_PAGE_REVIVE') {
        queueRecovery(message.reason || 'page-hook');
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === 'APPLY_TAB_STATE') {
        applyRuntimeState(message);
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === 'APPLY_LIVE_SETTINGS') {
        state.settings = normalizeSettings({ ...state.settings, ...(message.settings || {}) });
        state.lastError = '';
        syncAllMedia();
        sendResponse({ ok: true, settings: state.settings, status: getLiveStatus() });
        return false;
      }

      if (message?.type === 'GET_LIVE_STATUS') {
        sendResponse(getLiveStatus());
        return false;
      }

      return false;
    });

    document.addEventListener('play', (event) => {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      trackMedia(media);
      void resumeContext().then(() => {
        const ctrl = state.media.get(media);
        if (ctrl && ctrl.attached) {
          teardownController(ctrl, false);
          ctrl.attached = false;
        }
        syncMediaController(state.media.get(media));
      });
      syncMediaController(state.media.get(media));
    }, true);

    document.addEventListener('playing', (event) => {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      trackMedia(media);
      void resumeContext().then(() => {
        syncMediaController(state.media.get(media));
      });
    }, true);

    ['pointerdown', 'keydown', 'mousedown', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, () => {
        void resumeContext().then(() => {
          syncAllMedia();
        });
      }, { passive: true, capture: true });
    });

    state.listenersReady = true;
  }

  function ensureLifecycleListeners() {
    if (state.lifecycleListenersReady) return;

    const revive = (reason) => queueRecovery(reason);

    window.addEventListener('pageshow', () => revive('pageshow'), { passive: true });
    window.addEventListener('focus', () => revive('focus'), { passive: true });
    window.addEventListener('popstate', () => revive('popstate'), { passive: true });
    window.addEventListener('hashchange', () => revive('hashchange'), { passive: true });
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revive('visibilitychange');
    }, { passive: true });

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__slra !== true) return;

      if (data.type === 'SLRA_PAGE_REVIVE') {
        queueRecovery(data.reason || 'page-hook');
      }

      if (data.type === 'SLRA_PAGE_HOOK_READY') {
        state.pageHookReady = true;
        state.lastError = '';
      }
    });

    ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'spfdone'].forEach((eventName) => {
      window.addEventListener(eventName, () => revive(eventName), true);
    });

    state.lifecycleListenersReady = true;
  }

  function ensureObserver() {
    if (state.observer) return;

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        if (mutation.addedNodes.length || mutation.removedNodes.length) {
          queueScan();
          return;
        }
      }
    });

    const root = document.documentElement || document;
    state.observer.observe(root, { childList: true, subtree: true });
  }

  function applyRuntimeState(runtime) {
    state.eligible = Boolean(runtime?.eligible !== false);
    state.bypass = Boolean(runtime?.bypass);
    state.settings = normalizeSettings(runtime?.settings);
    state.lastError = '';
    syncAllMedia();
  }

  function queueScan() {
    if (state.scanQueued) return;
    state.scanQueued = true;
    queueMicrotask(() => {
      state.scanQueued = false;
      scanMediaElements();
      syncAllMedia();
    });
  }

  function queueRecovery(reason) {
    if (state.recoveryQueued) return;
    state.recoveryQueued = true;

    if (!state.pageHookReady || reason === 'bootstrap' || reason === 'missing-hook') {
      void requestHookRefresh(reason);
    }

    queueMicrotask(() => {
      state.recoveryQueued = false;
      queueScan();
      syncAllMedia();
    });
  }

  async function requestHookRefresh(reason) {
    if (state.hookRefreshQueued) return;
    state.hookRefreshQueued = true;

    try {
      await chrome.runtime.sendMessage({
        type: 'ENSURE_TAB_HOOKS',
        reason: String(reason || 'recovery'),
      });
    } catch {
      // Best effort only.
    } finally {
      state.hookRefreshQueued = false;
    }
  }

  function scanMediaElements() {
    document.querySelectorAll('audio,video').forEach((media) => {
      if (media instanceof HTMLMediaElement) {
        trackMedia(media);
      }
    });

    for (const [media, controller] of state.media.entries()) {
      if (media.isConnected) continue;
      teardownController(controller, true);
      state.media.delete(media);
    }
  }

  function trackMedia(media) {
    if (state.media.has(media)) return state.media.get(media);

    const controller = {
      media,
      attached: false,
      failed: false,
      attachError: '',
      stream: null,
      source: null,
      dryGain: null,
      wetInput: null,
      convolver: null,
      wetTone: null,
      wetGain: null,
      masterGain: null,
      originalRate: media.playbackRate,
      originalPitch: readPitchState(media),
      originalMuted: media.muted,
      internalRateWrite: false,
      rateHandler: null,
      resetHandler: null,
      loadHandler: null,
    };

    controller.rateHandler = () => {
      if (controller.internalRateWrite) return;
      if (shouldBeActiveForController(controller)) {
        setMediaPlaybackState(controller, state.settings.slow, false);
      } else {
        controller.originalRate = media.playbackRate;
        controller.originalPitch = readPitchState(media);
        controller.originalMuted = media.muted;
      }
    };

    controller.resetHandler = () => {
      if (controller.attached) {
        teardownController(controller, false);
        controller.attached = false;
        controller.stream = null;
        controller.source = null;
        controller.failed = false;
      }
      queueRecovery('emptied');
    };

    controller.loadHandler = () => {
      queueRecovery('loadedmetadata');
    };

    controller.volumeHandler = () => {
      if (!controller.attached || !controller.masterGain) return;
      controller.masterGain.gain.value = controller.media.volume;
    };

    media.addEventListener('ratechange', controller.rateHandler);
    media.addEventListener('emptied', controller.resetHandler);
    media.addEventListener('loadedmetadata', controller.loadHandler);
    media.addEventListener('volumechange', controller.volumeHandler);
    state.media.set(media, controller);
    return controller;
  }

  function shouldBeActiveForController(controller) {
    return state.eligible && !state.bypass && controller && controller.attached && !controller.failed;
  }

  function syncAllMedia() {
    for (const controller of state.media.values()) {
      syncMediaController(controller);
    }
  }

  function syncMediaController(controller) {
    if (!controller || !controller.media.isConnected) return;

    if (!state.eligible || state.bypass) {
      applyBypassState(controller);
      return;
    }

    if (!ensureAttached(controller)) {
      teardownController(controller, false);
      return;
    }

    updateWetChain(controller);
    setMediaPlaybackState(controller, state.settings.slow, false);
  }

  function applyBypassState(controller) {
    teardownController(controller, false);
  }

  function ensureAttached(controller) {
    if (controller.attached) return true;
    if (!isMediaReadyForAttach(controller.media)) return false;

    controller.failed = false;
    controller.attachError = '';

    controller.originalRate = controller.media.playbackRate;
    controller.originalPitch = readPitchState(controller.media);
    controller.originalMuted = controller.media.muted;

    try {
      const context = getAudioContext();
      const stream = controller.stream || captureMediaStream(controller.media);
      if (!stream) {
        throw new Error('captureStream unavailable for this media element.');
      }

      if (!stream.getAudioTracks().length) {
        stream.addEventListener('addtrack', function onTrack(event) {
          if (event.track.kind === 'audio') {
            stream.removeEventListener('addtrack', onTrack);
            queueScan();
          }
        });
      }

      const source = controller.source || context.createMediaStreamSource(stream);
      const dryGain = context.createGain();
      const wetInput = context.createGain();
      const convolver = context.createConvolver();
      const wetTone = context.createBiquadFilter();
      const wetGain = context.createGain();
      const masterGain = context.createGain();

      dryGain.gain.value = 1;
      wetInput.gain.value = 0.9;
      wetTone.type = 'lowpass';
      wetTone.frequency.value = 5000;
      wetTone.Q.value = 0.5;
      wetGain.gain.value = 0;
      masterGain.gain.value = controller.media.volume;

      source.connect(dryGain);
      dryGain.connect(masterGain);
      source.connect(wetInput);
      wetInput.connect(convolver);
      convolver.connect(wetTone);
      wetTone.connect(wetGain);
      wetGain.connect(masterGain);
      masterGain.connect(context.destination);

      controller.stream = stream;
      controller.source = source;
      controller.dryGain = dryGain;
      controller.wetInput = wetInput;
      controller.convolver = convolver;
      controller.wetTone = wetTone;
      controller.wetGain = wetGain;
      controller.masterGain = masterGain;
      controller.attached = true;
      controller.attachError = '';
      void resumeContext().then(() => {
        syncMediaController(controller);
      });
      return true;
    } catch (error) {
      controller.failed = true;
      controller.attachError = 'Could not attach audio effect.';
      state.lastError = String(error && error.message ? error.message : error);
      return false;
    }
  }

  function getAudioContext() {
    if (!state.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      state.context = new AudioContextCtor();
    }
    return state.context;
  }

  async function resumeContext() {
    if (!state.context || state.context.state === 'running') return;
    try {
      await state.context.resume();
    } catch {
      // Best effort only.
    }
  }

  function captureMediaStream(media) {
    if (typeof media.captureStream === 'function') {
      return media.captureStream();
    }

    if (typeof media.mozCaptureStream === 'function') {
      return media.mozCaptureStream();
    }

    return null;
  }

  function isMediaReadyForAttach(media) {
    return Boolean(
      media &&
      !media.paused &&
      !media.ended &&
      media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      (media.currentSrc || media.srcObject)
    );
  }

  function shouldMuteNativeElement(controller) {
    if (!state.context || state.context.state !== 'running') return false;
    if (!controller || !controller.stream) return false;
    try {
      const tracks = controller.stream.getAudioTracks();
      return tracks.length > 0 && tracks.some(t => t.enabled);
    } catch {
      return false;
    }
  }

  function updateWetChain(controller) {
    const flavor = normalizeFlavor(state.settings.reverbFlavor);
    const wetAmount = getCurvedWetAmount(state.settings.reverbIntensity, flavor);

    if (!controller.convolver || !controller.wetTone || !controller.wetGain) return;

    if (flavor === 'none' || wetAmount <= 0) {
      controller.wetGain.gain.value = 0;
      return;
    }

    controller.convolver.buffer = getPresetBuffer(flavor);

    const toneByFlavor = {
      moon: { frequency: 6200, q: 0.7 },
      mars: { frequency: 3100, q: 1.2 },
      jupiter: { frequency: 7600, q: 0.45 },
      pluto: { frequency: 2300, q: 1.5 },
    };

    const tone = toneByFlavor[flavor] || toneByFlavor.moon;
    controller.wetTone.frequency.value = tone.frequency;
    controller.wetTone.Q.value = tone.q;
    controller.wetGain.gain.value = wetAmount;
  }

  function getPresetBuffer(flavor) {
    if (state.presetBuffers.has(flavor)) {
      return state.presetBuffers.get(flavor);
    }

    const context = getAudioContext();
    const recipeByFlavor = {
      moon: { seconds: 2.7, decay: 2.4, brightness: 0.72, early: 0.2, late: 0.85 },
      mars: { seconds: 1.3, decay: 1.8, brightness: 0.38, early: 0.45, late: 0.35 },
      jupiter: { seconds: 3.8, decay: 2.9, brightness: 0.82, early: 0.18, late: 1 },
      pluto: { seconds: 2.2, decay: 2.7, brightness: 0.2, early: 0.12, late: 0.62 },
    };
    const recipe = recipeByFlavor[flavor] || recipeByFlavor.moon;
    const sampleRate = context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * recipe.seconds));
    const buffer = context.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let seed = 1 + flavor.length * 97;

    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const envelope = Math.pow(1 - progress, recipe.decay);
      const stereoSkew = 0.92 + progress * 0.08;
      seed = (seed * 16807) % 2147483647;
      const randA = (seed / 2147483647) * 2 - 1;
      seed = (seed * 16807) % 2147483647;
      const randB = (seed / 2147483647) * 2 - 1;
      const tint = recipe.brightness + (1 - progress) * recipe.early + progress * recipe.late;
      left[index] = randA * envelope * tint;
      right[index] = randB * envelope * tint * stereoSkew;
    }

    state.presetBuffers.set(flavor, buffer);
    return buffer;
  }

  function setMediaPlaybackState(controller, rate, preservePitch) {
    const media = controller.media;
    controller.internalRateWrite = true;

    try {
      if (rate >= 0.999) {
        applyPitchState(media, controller.originalPitch);
        media.playbackRate = controller.originalRate;
      } else {
        setPreservesPitch(media, preservePitch);
        media.playbackRate = rate;
      }
      media.muted = shouldMuteNativeElement(controller);
    } finally {
      setTimeout(() => {
        controller.internalRateWrite = false;
      }, 0);
    }
  }

  function teardownController(controller, removeCompletely) {
    if (!controller) return;

    if (controller.attached) {
      disconnectNode(controller.source);
      disconnectNode(controller.dryGain);
      disconnectNode(controller.wetInput);
      disconnectNode(controller.convolver);
      disconnectNode(controller.wetTone);
      disconnectNode(controller.wetGain);
      disconnectNode(controller.masterGain);
    }

    restoreMediaPlaybackState(controller);

    controller.attached = false;
    controller.stream = null;
    controller.source = null;
    controller.dryGain = null;
    controller.wetInput = null;
    controller.convolver = null;
    controller.wetTone = null;
    controller.wetGain = null;
    controller.masterGain = null;

    if (removeCompletely) {
      if (controller.rateHandler) {
        controller.media.removeEventListener('ratechange', controller.rateHandler);
        controller.rateHandler = null;
      }
      if (controller.resetHandler) {
        controller.media.removeEventListener('emptied', controller.resetHandler);
        controller.resetHandler = null;
      }
      if (controller.loadHandler) {
        controller.media.removeEventListener('loadedmetadata', controller.loadHandler);
        controller.loadHandler = null;
      }
      if (controller.volumeHandler) {
        controller.media.removeEventListener('volumechange', controller.volumeHandler);
        controller.volumeHandler = null;
      }
    }
  }

  function restoreMediaPlaybackState(controller) {
    const media = controller.media;
    controller.internalRateWrite = true;

    try {
      applyPitchState(media, controller.originalPitch);
      media.playbackRate = controller.originalRate;
      media.muted = controller.originalMuted;
    } catch {
      // Ignore restore failures.
    } finally {
      setTimeout(() => {
        controller.internalRateWrite = false;
      }, 0);
    }
  }

  function readPitchState(media) {
    return {
      preservesPitch: readMaybe(media, 'preservesPitch'),
      mozPreservesPitch: readMaybe(media, 'mozPreservesPitch'),
      webkitPreservesPitch: readMaybe(media, 'webkitPreservesPitch'),
    };
  }

  function applyPitchState(media, pitchState) {
    writeMaybe(media, 'preservesPitch', pitchState.preservesPitch);
    writeMaybe(media, 'mozPreservesPitch', pitchState.mozPreservesPitch);
    writeMaybe(media, 'webkitPreservesPitch', pitchState.webkitPreservesPitch);
  }

  function setPreservesPitch(media, value) {
    writeMaybe(media, 'preservesPitch', value);
    writeMaybe(media, 'mozPreservesPitch', value);
    writeMaybe(media, 'webkitPreservesPitch', value);
  }

  function readMaybe(target, key) {
    return key in target ? target[key] : undefined;
  }

  function writeMaybe(target, key, value) {
    if (!(key in target) || typeof value === 'undefined') return;
    target[key] = value;
  }

  function disconnectNode(node) {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  function getLiveStatus() {
    let attachedCount = 0;
    let failedCount = 0;

    for (const controller of state.media.values()) {
      if (controller.failed) failedCount += 1;
      if (controller.attached) attachedCount += 1;
    }

    const totalCount = state.media.size;
    const active = state.eligible && !state.bypass;
    let text = 'Waiting for media.';

    if (!state.eligible) {
      text = 'Unsupported page.';
    } else if (state.bypass) {
      text = 'Power off for this tab.';
    } else if (failedCount && !attachedCount) {
      text = 'Could not attach to page audio.';
    } else if (!totalCount) {
      text = 'Waiting for media.';
    } else if (isNeutral(state.settings)) {
      text = 'Active, neutral.';
    } else if (failedCount) {
      text = 'Active with some attach failures.';
    } else {
      text = 'Active.';
    }

    return {
      ok: true,
      eligible: state.eligible,
      bypass: state.bypass,
      active,
      neutral: active && isNeutral(state.settings),
      attachedCount,
      failedCount,
      totalCount,
      contextState: state.context ? state.context.state : 'idle',
      text,
      error: state.lastError || '',
    };
  }
})();
