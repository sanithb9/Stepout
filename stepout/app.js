/* ============================================================
   app.js – Step Out PWA v1.0.4
   ============================================================ */
'use strict';

const App = (() => {

  const state = {
    lat: 51.5074,  // Default: London, updated once geo resolves
    lon: -0.1278,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.4',
  };

  // ── Init ────────────────────────────────────────────────────
  async function init() {
    console.log('[App] Step Out v' + state.version);

    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    Theme.init();

    // Language — 3s timeout so a slow fetch never blocks the app
    try {
      const lang = I18n.detectLanguage();
      await Promise.race([
        I18n.load(lang),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
    } catch (e) {
      console.warn('[App] i18n load failed:', e.message);
    }

    PWAInstall.init();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);
    bindEvents();

    // Use cached or default location — load weather immediately
    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat;
      state.lon = cached.lon;
      state.locationName = cached.name;
      setLocationDisplay(cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
    }

    fetchAndRenderWeather(state.lat, state.lon);
    AppMap.init(state.lat, state.lon);

    // Geolocation runs in background — updates when ready
    tryGeolocation();

    trackEvent('app_open');
  }

  // ── Geolocation ─────────────────────────────────────────────
  async function tryGeolocation() {
    setLocationDisplay(I18n.t('detecting_location') || 'Detecting location…');
    try {
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat;
      state.lon = pos.lon;

      GeoHelper.reverseGeocode(pos.lat, pos.lon).then(name => {
        state.locationName = name;
        setLocationDisplay(name);
        GeoHelper.saveLocation(pos.lat, pos.lon, name);
      }).catch(() => {});

      fetchAndRenderWeather(state.lat, state.lon);
      AppMap.panTo(state.lat, state.lon);
    } catch (err) {
      console.warn('[App] Geo unavailable:', err.message);
      const cached = GeoHelper.getCached();
      setLocationDisplay(cached ? cached.name + ' (cached)' : 'London, UK (default)');
    }
  }

  function setLocationDisplay(text) {
    const el = document.getElementById('location-display');
    if (el) el.textContent = text;
  }

  // ── Events ───────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('theme-toggle')
      ?.addEventListener('click', () => Theme.toggle());

    document.getElementById('lang-selector')
      ?.addEventListener('change', async e => {
        await I18n.load(e.target.value);
        if (state.weatherData) WeatherUI.renderCurrent(state.weatherData.current);
        if (state.dryWindowResult)
          WeatherUI.renderDryWindow(DryWindow.formatWindow(state.dryWindowResult, I18n.getLang()));
      });

    document.getElementById('find-dry-window')
      ?.addEventListener('click', () => {
        handleFindDryWindow();
        trackEvent('find_dry_window_click');
      });

    document.getElementById('refresh-location')
      ?.addEventListener('click', () => tryGeolocation());

    document.getElementById('retry-weather')
      ?.addEventListener('click', () => fetchAndRenderWeather(state.lat, state.lon));

    document.getElementById('toggle-clouds')
      ?.addEventListener('click', () => AppMap.setMode('clouds'));
    document.getElementById('toggle-satellite')
      ?.addEventListener('click', () => AppMap.setMode('satellite'));
  }

  // ── Weather ──────────────────────────────────────────────────
  async function fetchAndRenderWeather(lat, lon) {
    UIState.showSkeleton('weather');
    try {
      const data = await WeatherAPI.fetch(lat, lon);
      state.weatherData = data;

      if (data.fromCache || !state.isOnline) UIState.showOfflineBanner(true);

      UIState.setDataSource(data.source);
      WeatherUI.renderCurrent(data.current);
      UIState.showContent('weather');

      if (data.hourly?.length)     WeatherUI.renderHourly(data.hourly);
      if (data.minutely15?.length) WeatherUI.renderTimeline(data.minutely15, null);

      trackEvent('weather_fetch', { source: data.source });
    } catch (err) {
      console.error('[App] Weather failed:', err);
      UIState.showError('weather');
    }
  }

  // ── Dry Window ───────────────────────────────────────────────
  async function handleFindDryWindow() {
    if (!state.weatherData?.minutely15?.length) {
      WeatherUI.showDryWindowSkeleton();
      await fetchAndRenderWeather(state.lat, state.lon);
      if (!state.weatherData?.minutely15?.length) { showNoWindowFallback(); return; }
    }

    WeatherUI.showDryWindowSkeleton();
    await new Promise(r => setTimeout(r, 350));

    try {
      const result = DryWindow.findDryWindow(state.weatherData.minutely15, 10);
      state.dryWindowResult = result;
      WeatherUI.renderDryWindow(result ? DryWindow.formatWindow(result, I18n.getLang()) : null);
      if (state.weatherData.minutely15?.length)
        WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      if (state.lat && state.lon) AppMap.panTo(state.lat, state.lon);
    } catch (err) {
      console.error('[App] DryWindow error:', err);
      showNoWindowFallback();
    }
  }

  function showNoWindowFallback() {
    UIState.showSection('dry-window-section');
    UIState.setVisible('dry-window-none', true);
    UIState.setVisible('dry-window-result', false);
    UIState.hideSection('dry-window-skeleton');
  }

  // ── Online/offline ───────────────────────────────────────────
  function handleOnline() {
    state.isOnline = true;
    UIState.showOfflineBanner(false);
    if (state.lat && state.lon) fetchAndRenderWeather(state.lat, state.lon);
  }
  function handleOffline() {
    state.isOnline = false;
    UIState.showOfflineBanner(true);
  }

  // ── Analytics ────────────────────────────────────────────────
  function trackEvent(name, props = {}) {
    try { if (typeof window.plausible === 'function') window.plausible(name, { props }); }
    catch { /* ignore */ }
  }

  return { init, state };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
