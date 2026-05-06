importScripts('shared.js');

const {
  extractHostname,
  isSupportedUrl,
  normalizeSettings,
} = self.SlowedReverbShared;

const TAB_BYPASS_PREFIX = 'tabBypass_';
const SITE_SETTINGS_PREFIX = 'siteSettings_';
const TAB_SESSION_PREFIX = 'tabSession_';
const REMEMBER_KEY = 'rememberEnabled';

function getEligibleTab(tabId) {
  if (tabId == null) return null;
  return chrome.tabs.get(tabId).catch(() => null);
}

function isEligibleTab(tab) {
  return Boolean(tab?.id) && isSupportedUrl(tab.url);
}

async function injectMainWorldHook(tabId) {
  const tab = await getEligibleTab(tabId);
  if (!isEligibleTab(tab)) return { ok: false, error: 'unsupported' };

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['page-hook.js'],
      world: 'MAIN',
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

async function getTabBypass(tabId) {
  const key = TAB_BYPASS_PREFIX + String(tabId);
  const stored = await chrome.storage.session.get({ [key]: false });
  return Boolean(stored[key]);
}

async function setTabBypass(tabId, bypass) {
  const key = TAB_BYPASS_PREFIX + String(tabId);
  if (bypass) {
    await chrome.storage.session.set({ [key]: true });
  } else {
    await chrome.storage.session.remove(key);
  }
}

async function clearTabBypass(tabId) {
  const key = TAB_BYPASS_PREFIX + String(tabId);
  await chrome.storage.session.remove(key);
}

async function getStoredSiteSettings(siteKey) {
  const key = SITE_SETTINGS_PREFIX + siteKey;
  const stored = await chrome.storage.local.get({ [key]: null });
  return stored[key];
}

async function setStoredSiteSettings(siteKey, settings) {
  const key = SITE_SETTINGS_PREFIX + siteKey;
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [key]: normalized });
  return normalized;
}

async function getRememberEnabled() {
  const stored = await chrome.storage.local.get({ [REMEMBER_KEY]: true });
  return stored[REMEMBER_KEY] !== false;
}

async function setRememberEnabled(value) {
  await chrome.storage.local.set({ [REMEMBER_KEY]: Boolean(value) });
}

async function getTabSession(tabId) {
  const key = TAB_SESSION_PREFIX + String(tabId);
  const stored = await chrome.storage.session.get({ [key]: null });
  return stored[key];
}

async function setTabSession(tabId, settings) {
  const key = TAB_SESSION_PREFIX + String(tabId);
  await chrome.storage.session.set({ [key]: normalizeSettings(settings) });
}

async function clearTabSession(tabId) {
  const key = TAB_SESSION_PREFIX + String(tabId);
  await chrome.storage.session.remove(key);
}

async function resolveSettingsForTab(tabId) {
  const tab = await getEligibleTab(tabId);
  const eligible = isEligibleTab(tab);
  const siteKey = tab ? extractHostname(tab.url) : '';
  const session = await getTabSession(tabId);

  if (session) {
    return { eligible, siteKey, settings: normalizeSettings(session) };
  }

  if (eligible && siteKey && (await getRememberEnabled())) {
    const siteSettings = await getStoredSiteSettings(siteKey);
    return { eligible, siteKey, settings: normalizeSettings(siteSettings) };
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
    rememberEnabled: await getRememberEnabled(),
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
  for (const tab of tabs) {
    if (!isEligibleTab(tab)) continue;
    await pushTabState(tab.id);
  }
}

async function migrateOldStorageFormat() {
  const oldKey = 'siteSettings';
  const stored = await chrome.storage.local.get({ [oldKey]: {} });
  const oldData = stored[oldKey];
  if (oldData && typeof oldData === 'object') {
    const entries = Object.entries(oldData);
    if (entries.length > 0) {
      const writes = {};
      for (const [siteKey, settings] of entries) {
        writes[SITE_SETTINGS_PREFIX + siteKey] = normalizeSettings(settings);
      }
      await chrome.storage.local.set(writes);
      await chrome.storage.local.remove(oldKey);
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!tabId || (changeInfo.status !== 'complete' && typeof changeInfo.url !== 'string')) {
    return;
  }

  void pushTabState(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabBypass(tabId);
  void clearTabSession(tabId);
});

chrome.runtime.onStartup.addListener(() => {
  void rehydrateAllTabs();
});

chrome.runtime.onInstalled.addListener(() => {
  void migrateOldStorageFormat();
  void rehydrateAllTabs();
});

let writeQueue = Promise.resolve();

async function serializedWrite(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

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
        const rememberEnabled = await getRememberEnabled();
        const persist = message.persist !== false && rememberEnabled;

        return serializedWrite(async () => {
          if (persist && message.siteKey) {
            await setStoredSiteSettings(message.siteKey, settings);
          }
          await setTabSession(tabId, settings);

          const push = await pushTabState(tabId);
          return { ok: true, settings, pushed: push.ok };
        });
      }
      case 'SET_REMEMBER': {
        await setRememberEnabled(Boolean(message.value));
        if (message.value && message.siteKey && message.settings) {
          const tabId = Number(message.tabId);
          await setStoredSiteSettings(message.siteKey, message.settings);
          await clearTabSession(tabId);
        }
        return { ok: true };
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
        return injectMainWorldHook(tabId);
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
