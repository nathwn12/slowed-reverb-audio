(() => {
  const existing = globalThis.__slowedReverbAudioContent;
  if (existing?.refresh) {
    existing.refresh();
    return;
  }

  const {
    getDefaultSettings,
    isNeutral,
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
    listenersReady: false,
    lifecycleListenersReady: false,
    pageHookReady: false,
    lastError: '',
    workletLoaded: false,
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
      syncMediaController(state.media.get(media));
      void resumeContext().then(() => {
        syncMediaController(state.media.get(media));
      });
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

  function queueCriticalRecovery(reason) {
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
      teardownController(controller, true, state.context);
      state.media.delete(media);
    }
  }

  function trackMedia(media) {
    if (state.media.has(media)) return state.media.get(media);

    const controller = {
      media,
      attached: false,
      attachedSrc: '',
      failed: false,
      attachError: '',
      stream: null,
      source: null,
      dryGain: null,
      masterGain: null,
      dattorroNode: null,
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
        teardownController(controller, false, state.context);
        controller.attached = false;
        controller.stream = null;
        controller.source = null;
        controller.failed = false;
      }
      queueCriticalRecovery('emptied');
    };

    controller.loadHandler = () => {
      if (controller.attached) {
        teardownController(controller, false, state.context);
        controller.attached = false;
        controller.stream = null;
        controller.source = null;
        controller.failed = false;
      }
      queueCriticalRecovery('loadedmetadata');
    };

    controller.volumeHandler = () => {
      if (!controller.attached || !controller.masterGain) return;
      controller.masterGain.gain.value = controller.media.volume;
      setMediaPlaybackState(controller, state.settings.slow, false);
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
      teardownController(controller, false, state.context);
      return;
    }

    updateWetChain(controller);
    setMediaPlaybackState(controller, state.settings.slow, false);
  }

  function applyBypassState(controller) {
    teardownController(controller, false, state.context);
  }

  function ensureAttached(controller) {
    if (controller.attached) {
      const currentSrc = controller.media.currentSrc;
      if (!currentSrc || currentSrc === controller.attachedSrc) {
        return true;
      }
      teardownController(controller, false, state.context);
    }
    if (!isMediaReadyForAttach(controller.media)) return false;

    const context = getAudioContext();
    if (!state.workletLoaded || context.state !== 'running') return false;

    controller.failed = false;
    controller.attachError = '';

    controller.originalRate = controller.media.playbackRate;
    controller.originalPitch = readPitchState(controller.media);
    controller.originalMuted = controller.media.muted;

    try {
      const stream = captureMediaStream(controller.media);
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

      const source = context.createMediaStreamSource(stream);
      const dryGain = context.createGain();
      const masterGain = context.createGain();
      const dattorroNode = new AudioWorkletNode(context, 'dattorro-reverb');

      dattorroNode.port.postMessage({ type: 'reset' });
      dattorroNode.port.postMessage({ type: 'setParams', params: computeDattorroParams(state.settings.reverbIntensity) });

      dryGain.gain.value = 1;
      masterGain.gain.value = 0;

      source.connect(dryGain);
      dryGain.connect(masterGain);
      source.connect(dattorroNode);
      dattorroNode.connect(masterGain);
      masterGain.connect(context.destination);

      masterGain.gain.linearRampToValueAtTime(controller.media.volume, context.currentTime + 0.04);

      controller.stream = stream;
      controller.source = source;
      controller.dryGain = dryGain;
      controller.masterGain = masterGain;
      controller.dattorroNode = dattorroNode;
      controller.attached = true;
      controller.attachedSrc = controller.media.currentSrc;
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
      void loadWorklet(state.context);
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

  async function loadWorklet(context) {
    try {
      const url = chrome.runtime.getURL('dattorro-worklet.js');
      await context.audioWorklet.addModule(url);
      state.workletLoaded = true;
      syncAllMedia();
    } catch (e) {
      state.lastError = 'Worklet: ' + (e.message || e);
    }
  }

  function computeDattorroParams(intensity) {
    const i = Math.max(0, Math.min(1, intensity));
    if (i <= 0) {
      return { wetGain: 0, decay: 0, damping: 1, preDelay: 0 };
    }
    return {
      preDelay: 0.3 + i * 0.5,
      preFilter: 0.7 + i * 0.2,
      inputDiff1: 0.75,
      inputDiff2: 0.625,
      decayDiff1: 0.6 + i * 0.2,
      decay: Math.pow(i, 1.3) * 0.85,
      damping: 0.5 + Math.pow(i, 0.6) * 0.4,
      wetGain: Math.pow(i, 1.5) * 0.7,
    };
  }

  function updateWetChain(controller) {
    if (!controller.dattorroNode) return;
    const params = computeDattorroParams(state.settings.reverbIntensity);
    controller.dattorroNode.port.postMessage({ type: 'setParams', params });
  }

  function setMediaPlaybackState(controller, rate, preservePitch) {
    const media = controller.media;
    controller.internalRateWrite = true;

    try {
      if (Math.abs(rate - 1) < 0.001) {
        applyPitchState(media, controller.originalPitch);
        media.playbackRate = controller.originalRate;
      } else {
        setPreservesPitch(media, preservePitch);
        media.playbackRate = rate;
      }
      media.muted = controller.attached;
    } finally {
      setTimeout(() => {
        controller.internalRateWrite = false;
      }, 0);
    }
  }

  function teardownController(controller, removeCompletely, context) {
    if (!controller) return;

    if (controller.attached) {
      if (controller.masterGain) {
        try {
          const ctx = context || state.context;
          if (ctx) {
            controller.masterGain.gain.setValueAtTime(controller.masterGain.gain.value, ctx.currentTime);
            controller.masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.005);
          }
        } catch {}
      }
      disconnectNode(controller.source);
      disconnectNode(controller.dryGain);
      disconnectNode(controller.masterGain);
      if (controller.dattorroNode) {
        try { controller.dattorroNode.disconnect(); } catch {}
      }
    }

    restoreMediaPlaybackState(controller);

    controller.attached = false;
    controller.attachedSrc = '';
    controller.stream = null;
    controller.source = null;
    controller.dryGain = null;
    controller.masterGain = null;
    controller.dattorroNode = null;

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
