try { importScripts('shared.js'); } catch {} // Firefox uses background.scripts instead

const {
  extractHostname,
  isSupportedUrl,
  normalizeSettings,
} = self.SlowedReverbShared;

const TAB_BYPASS_KEY = 'tabBypassById';
const SITE_SETTINGS_KEY = 'siteSettings';
const TAB_SESSION_KEY = 'tabSessionById';

const tabBypassById = new Map();
const tabSessionById = new Map();

function getEligibleTab(tabId) {
  if (tabId == null) return null;
  return chrome.tabs.get(tabId).catch(() => null);
}

function isEligibleTab(tab) {
  return Boolean(tab?.id) && isSupportedUrl(tab.url);
}

async function injectMainWorldScript(tabId, file) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
      world: 'MAIN',
    });
  } catch {
    await chrome.tabs.executeScript(tabId, { file });
  }
}

async function injectMainWorldHook(tabId) {
  const tab = await getEligibleTab(tabId);
  if (!isEligibleTab(tab)) return { ok: false, error: 'unsupported' };

  try {
    await injectMainWorldScript(tabId, 'page-hook.js');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function getStoredBypassMap() {
  return Object.fromEntries(tabBypassById);
}

async function getTabBypass(tabId) {
  const byTabId = await getStoredBypassMap();
  return Boolean(byTabId[String(tabId)]);
}

async function setTabBypass(tabId, bypass) {
  if (bypass) {
    tabBypassById.set(tabId, true);
  } else {
    tabBypassById.delete(tabId);
  }
}

async function clearTabBypass(tabId) {
  if (!tabBypassById.has(tabId)) return;
  tabBypassById.delete(tabId);
}

async function getStoredSiteSettings() {
  const stored = await chrome.storage.local.get({ [SITE_SETTINGS_KEY]: {} });
  return stored[SITE_SETTINGS_KEY] || {};
}

async function setStoredSiteSettings(siteKey, settings) {
  const all = await getStoredSiteSettings();
  all[siteKey] = normalizeSettings(settings);
  await chrome.storage.local.set({ [SITE_SETTINGS_KEY]: all });
  return all[siteKey];
}

async function getTabSession(tabId) {
  return tabSessionById.get(tabId) || null;
}

async function setTabSession(tabId, settings) {
  tabSessionById.set(tabId, normalizeSettings(settings));
}

async function clearTabSession(tabId) {
  tabSessionById.delete(tabId);
}

async function resolveSettingsForTab(tabId) {
  const tab = await getEligibleTab(tabId);
  const eligible = isEligibleTab(tab);
  const siteKey = tab ? extractHostname(tab.url) : '';
  const session = await getTabSession(tabId);

  if (session) {
    return { eligible, siteKey, settings: normalizeSettings(session) };
  }

  if (eligible && siteKey) {
    const all = await getStoredSiteSettings();
    const stored = all[siteKey];
    if (stored) {
      return { eligible, siteKey, settings: normalizeSettings(stored) };
    }
  }

  return { eligible, siteKey, settings: normalizeSettings(null) };
}

async function buildTabState(tabId) {
  const tab = await getEligibleTab(tabId);
  const eligible = isEligibleTab(tab);
  const bypass = eligible ? await getTabBypass(tabId) : false;
  const { siteKey, settings } = await resolveSettingsForTab(tabId);

  return {
    ok: true,
    eligible,
    bypass,
    settings,
    siteKey,
  };
}

async function pushTabState(tabId) {
  const tab = await getEligibleTab(tabId);
  if (!isEligibleTab(tab)) return { ok: false, error: 'unsupported' };

  const payload = await buildTabState(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'APPLY_TAB_STATE',
      bypass: payload.bypass,
      settings: payload.settings,
    });
    return { ok: true };
  } catch {
    await injectMainWorldHook(tabId);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'APPLY_TAB_STATE',
        bypass: payload.bypass,
        settings: payload.settings,
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  }
}

async function rehydrateAllTabs() {
  const tabs = await chrome.tabs.query({});
  const eligible = tabs.filter(t => isEligibleTab(t));
  const CONCURRENCY = 5;
  let i = 0;

  const next = () => {
    if (i >= eligible.length) return Promise.resolve();
    const tab = eligible[i++];
    return pushTabState(tab.id).then(next, next);
  };

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, eligible.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);
}

const pendingUpdates = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!tabId || (changeInfo.status !== 'complete' && typeof changeInfo.url !== 'string')) {
    return;
  }

  if (pendingUpdates.has(tabId)) return;
  pendingUpdates.set(tabId, true);

  pushTabState(tabId).finally(() => {
    pendingUpdates.delete(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  Promise.all([
    clearTabBypass(tabId),
    clearTabSession(tabId),
  ]).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void rehydrateAllTabs();
});

chrome.runtime.onInstalled.addListener(() => {
  void rehydrateAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  void (async () => {
    switch (message.type) {
      case 'GET_POPUP_STATE': {
        const tabId = Number(message.tabId);
        await injectMainWorldHook(tabId);
        return buildTabState(message.tabId);
      }
      case 'GET_TAB_RUNTIME_STATE': {
        return buildTabState(sender.tab?.id || message.tabId);
      }
      case 'SET_SITE_SETTINGS': {
        const tabId = Number(message.tabId);
        const settings = normalizeSettings(message.settings);

        if (message.siteKey) {
          await setStoredSiteSettings(message.siteKey, settings);
        }
        await setTabSession(tabId, settings);

        const push = await pushTabState(tabId);
        return { ok: true, settings, pushed: push.ok };
      }
      case 'SET_TAB_BYPASS': {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Missing tabId.');
        await setTabBypass(tabId, Boolean(message.bypass));
        const push = await pushTabState(tabId);
        const state = await buildTabState(tabId);
        return { ...state, pushed: push.ok, pushError: push.error || '' };
      }
      case 'ENSURE_TAB_HOOKS': {
        const tabId = Number(message.tabId || sender.tab?.id);
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Missing tabId.');
        await injectMainWorldHook(tabId);
        return pushTabState(tabId);
      }
      default:
        return { ok: false, error: 'unknown_message' };
    }
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    });

  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.siteToggles) {
    const newToggles = changes.siteToggles.newValue || {};
    const oldToggles = changes.siteToggles.oldValue || {};
    for (const siteKey of Object.keys(newToggles)) {
      if (newToggles[siteKey] !== oldToggles[siteKey]) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.url) {
              try {
                const hostname = new URL(tab.url).hostname.toLowerCase();
                if (hostname === siteKey || hostname + ':443' === siteKey) {
                  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CHANGED', siteKey, enabled: newToggles[siteKey] }).catch(() => {});
                }
              } catch {}
            }
          });
        });
      }
    }
  }
});
