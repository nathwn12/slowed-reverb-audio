(function (root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.SlowedReverbShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUPPORTED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com']);
  const DEFAULT_SETTINGS = {
    slow: 1,
    reverbIntensity: 0.34,
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

  function normalizeSettings(raw) {
    const next = raw && typeof raw === 'object' ? raw : {};
    return {
      slow: clampSlow(Object.prototype.hasOwnProperty.call(next, 'slow') ? next.slow : DEFAULT_SETTINGS.slow),
      reverbIntensity: clampIntensity(
        Object.prototype.hasOwnProperty.call(next, 'reverbIntensity') ? next.reverbIntensity : DEFAULT_SETTINGS.reverbIntensity
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

  return {
    DEFAULT_SETTINGS,
    SUPPORTED_HOSTS,
    clampIntensity,
    clampSlow,
    extractHostname,
    formatPercent,
    formatRate,
    getDefaultSettings,
    getSiteKey,
    isNeutral,
    isSupportedHost,
    isSupportedUrl,
    normalizeSettings,
  };
});
