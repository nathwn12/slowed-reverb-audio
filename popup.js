const pageTitleEl = document.getElementById('page-title');
const resetBtnEl = document.getElementById('reset-btn');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');
const powerToggleEl = document.getElementById('power-toggle');
const rememberToggleEl = document.getElementById('remember-toggle');
const slowSliderEl = document.getElementById('slow-slider');
const slowReadoutEl = document.getElementById('slow-readout');
const intensitySliderEl = document.getElementById('intensity-slider');
const intensityReadoutEl = document.getElementById('intensity-readout');

const {
  formatPercent,
  formatRate,
  getDefaultSettings,
  normalizeSettings,
} = globalThis.SlowedReverbShared;
const defaultSettings = getDefaultSettings();

const APPLY_THROTTLE_MS = 40;

let activeTabId = null;
let siteKey = '';
let popupState = {
  eligible: false,
  bypass: false,
  rememberEnabled: true,
  settings: normalizeSettings(),
};
let pollTimer = null;
let lastApplyTime = 0;
let applying = false;
let pendingSettings = null;

void init();

powerToggleEl.addEventListener('change', () => {
  void updateTabBypass(!powerToggleEl.checked);
});

rememberToggleEl.addEventListener('change', () => {
  void handleRememberChange();
});

slowSliderEl.addEventListener('input', () => {
  const settings = { ...popupState.settings, slow: Number(slowSliderEl.value) };
  applySettingsToUi(settings);
  throttledApply(settings);
});

intensitySliderEl.addEventListener('input', () => {
  const settings = { ...popupState.settings, reverbIntensity: Number(intensitySliderEl.value) };
  applySettingsToUi(settings);
  throttledApply(settings);
});

resetBtnEl.addEventListener('click', () => {
  applySettingsToUi(defaultSettings);
  void applySettings(defaultSettings);
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
    pageTitleEl.textContent = getPageLabel(tab?.url || '');

    if (!activeTabId) {
      setSupportedUi(false);
      renderStatus('gray', 'No active tab.');
      return;
    }

    const state = await chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE', tabId: activeTabId });
    siteKey = state?.siteKey || '';

    popupState = {
      eligible: Boolean(state?.eligible),
      bypass: Boolean(state?.bypass),
      rememberEnabled: state?.rememberEnabled !== false,
      settings: normalizeSettings(state?.settings),
    };

    powerToggleEl.checked = !popupState.bypass;
    rememberToggleEl.checked = popupState.rememberEnabled;
    applySettingsToUi(popupState.settings);
    setSupportedUi(popupState.eligible);
    await refreshLiveStatus();

    if (popupState.eligible) {
      pollTimer = setInterval(() => {
        void refreshLiveStatus();
      }, 1000);
    }
  } catch {
    setSupportedUi(false);
    renderStatus('red', 'Could not load popup state.');
  }
}

function getPageLabel(url) {
  try {
    const host = new URL(url).hostname;
    if (host === 'music.youtube.com') return 'YouTube Music';
    if (host === 'youtube.com' || host === 'www.youtube.com') return 'YouTube';
  } catch {}
  return 'Unsupported';
}

function setSupportedUi(supported) {
  slowSliderEl.disabled = !supported;
  intensitySliderEl.disabled = !supported;
  powerToggleEl.disabled = !supported;
  rememberToggleEl.disabled = !supported;
}

function applySettingsToUi(settings) {
  const normalized = normalizeSettings(settings);
  popupState.settings = normalized;
  slowSliderEl.value = String(normalized.slow);
  intensitySliderEl.value = String(normalized.reverbIntensity);
  slowReadoutEl.textContent = formatRate(normalized.slow);
  intensityReadoutEl.textContent = formatPercent(normalized.reverbIntensity);
}

function throttledApply(settings) {
  const now = Date.now();
  if (now - lastApplyTime >= APPLY_THROTTLE_MS) {
    lastApplyTime = now;
    pendingSettings = settings;
    if (!applying) {
      applying = true;
      void flushApply();
    }
  }
}

async function flushApply() {
  try {
    while (pendingSettings) {
      const settings = pendingSettings;
      pendingSettings = null;
      await applySettings(settings);
    }
    await refreshLiveStatus();
  } finally {
    applying = false;
  }
}

async function applySettings(settings) {
  const normalized = normalizeSettings(settings);
  popupState.settings = normalized;

  await Promise.all([
    chrome.runtime.sendMessage({
      type: 'SET_SITE_SETTINGS',
      tabId: activeTabId,
      siteKey,
      settings: normalized,
      persist: popupState.rememberEnabled,
    }),
    ...(activeTabId && popupState.eligible
      ? [chrome.tabs.sendMessage(activeTabId, { type: 'APPLY_LIVE_SETTINGS', settings: normalized }).catch(() => {})]
      : []),
  ]);

  await refreshLiveStatus();
}

async function updateTabBypass(bypass) {
  if (!activeTabId) return;
  try {
    const state = await chrome.runtime.sendMessage({
      type: 'SET_TAB_BYPASS',
      tabId: activeTabId,
      bypass,
    });
    popupState.bypass = Boolean(state?.bypass);
    powerToggleEl.checked = !popupState.bypass;
    await refreshLiveStatus();
  } catch {
    powerToggleEl.checked = !bypass;
    renderStatus('red', 'Could not update tab power state.');
  }
}

async function handleRememberChange() {
  const enabled = rememberToggleEl.checked;
  popupState.rememberEnabled = enabled;

  await chrome.runtime.sendMessage({
    type: 'SET_REMEMBER',
    value: enabled,
    siteKey,
    tabId: activeTabId,
    settings: enabled ? popupState.settings : undefined,
  });

  if (enabled && siteKey && activeTabId) {
    await applySettings(popupState.settings);
    await refreshLiveStatus();
  }
}

async function refreshLiveStatus() {
  if (!popupState.eligible || !activeTabId) {
    renderStatus('gray', 'Only works on YouTube and YouTube Music.');
    return;
  }

  try {
    const live = await chrome.tabs.sendMessage(activeTabId, { type: 'GET_LIVE_STATUS' });
    if (!live?.ok) {
      renderStatus('gray', 'Status unavailable.');
      return;
    }

    const error = live.error || (live.failedCount ? live.text : '');
    const dotColor = error ? 'red' : live.bypass ? 'gray' : live.attachedCount ? 'green' : 'gray';
    renderStatus(dotColor, buildStatusText(live));
  } catch {
    renderStatus('gray', 'Waiting for tab content script.');
  }
}

function buildStatusText(live) {
  if (live.bypass) return 'Power off for this tab.';
  if (!live.totalCount) return 'Waiting for media element.';
  if (live.failedCount && !live.attachedCount) return 'Could not attach to page audio.';
  if (live.neutral) return 'Active with neutral settings.';
  if (live.failedCount) return 'Active with some attach failures.';
  return 'Active on ' + live.attachedCount + ' media element' + (live.attachedCount === 1 ? '.' : 's.');
}

function renderStatus(dotColor, text) {
  statusDotEl.className = dotColor === 'red' ? 'red' : dotColor === 'green' ? 'green' : '';
  statusTextEl.textContent = text;
}
