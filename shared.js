(function (root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.SlowedReverbShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUPPORTED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com']);
  const REVERB_FLAVORS = ['none', 'moon', 'mars', 'jupiter', 'pluto'];
  const DEFAULT_SETTINGS = {
    slow: 1,
    reverbFlavor: 'moon',
    reverbIntensity: 0.34,
    lastReverbFlavor: 'moon',
    lastReverbIntensity: 0.34,
  };

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function clampSlow(value) {
    return Math.round(clamp(value, 0.6, 1) * 100) / 100;
  }

  function clampIntensity(value) {
    return Math.round(clamp(value, 0, 1) * 100) / 100;
  }

  function normalizeFlavor(value) {
    const flavor = String(value || '').toLowerCase();
    return REVERB_FLAVORS.includes(flavor) ? flavor : DEFAULT_SETTINGS.reverbFlavor;
  }

  function normalizeActiveFlavor(value) {
    const flavor = normalizeFlavor(value);
    return flavor === 'none' ? DEFAULT_SETTINGS.lastReverbFlavor : flavor;
  }

  function normalizeSettings(raw) {
    const next = raw && typeof raw === 'object' ? raw : {};
    return {
      slow: clampSlow(Object.prototype.hasOwnProperty.call(next, 'slow') ? next.slow : DEFAULT_SETTINGS.slow),
      reverbFlavor: normalizeFlavor(next.reverbFlavor),
      reverbIntensity: clampIntensity(
        Object.prototype.hasOwnProperty.call(next, 'reverbIntensity') ? next.reverbIntensity : DEFAULT_SETTINGS.reverbIntensity
      ),
      lastReverbFlavor: normalizeActiveFlavor(next.lastReverbFlavor),
      lastReverbIntensity: clampIntensity(
        Object.prototype.hasOwnProperty.call(next, 'lastReverbIntensity')
          ? next.lastReverbIntensity
          : Object.prototype.hasOwnProperty.call(next, 'reverbIntensity') && Number(next.reverbIntensity) > 0
            ? next.reverbIntensity
            : DEFAULT_SETTINGS.lastReverbIntensity
      ),
    };
  }

  function getDefaultSettings() {
    return normalizeSettings(DEFAULT_SETTINGS);
  }

  function extractHostname(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function getSiteKey(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  function isSupportedHost(hostname) {
    return SUPPORTED_HOSTS.has(String(hostname || '').toLowerCase());
  }

  function isSupportedUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && isSupportedHost(parsed.hostname);
    } catch {
      return false;
    }
  }

  function formatRate(value) {
    return clampSlow(value).toFixed(2) + 'x';
  }

  function formatPercent(value) {
    return Math.round(clampIntensity(value) * 100) + '%';
  }

  function isNeutral(settings) {
    const normalized = normalizeSettings(settings);
    return normalized.slow === 1 && normalized.reverbIntensity === 0;
  }

  function getCurvedWetAmount(intensity, flavor) {
    const safeIntensity = clampIntensity(intensity);
    if (normalizeFlavor(flavor) === 'none' || safeIntensity <= 0) return 0;
    const maxWetByFlavor = {
      moon: 0.85,
      mars: 0.65,
      jupiter: 1.00,
      pluto: 0.80,
    };
    const maxWet = maxWetByFlavor[normalizeFlavor(flavor)] || 0.85;
    return Math.pow(safeIntensity, 1.7) * maxWet;
  }

  return {
    DEFAULT_SETTINGS,
    REVERB_FLAVORS,
    SUPPORTED_HOSTS,
    clampIntensity,
    clampSlow,
    extractHostname,
    formatPercent,
    formatRate,
    getCurvedWetAmount,
    getDefaultSettings,
    getSiteKey,
    isNeutral,
    isSupportedHost,
    isSupportedUrl,
    normalizeActiveFlavor,
    normalizeFlavor,
    normalizeSettings,
  };
});
