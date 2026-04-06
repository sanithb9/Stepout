/* ============================================================
   app.js – Step Out PWA v1.0.6
   ============================================================ */
'use strict';

const App = (() => {

  const state = {
    lat: 51.5074,
    lon: -0.1278,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.6',
  };

  async function init() {
    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    try { Theme.init(); } catch(e) { console.error('Theme init failed:', e); }

    // i18n loads in background — does not block app boot
    const lang = (() => {
      try { return I18n.detectLanguage(); } catch { return 'en'; }
    })();
    Promise.race([
      I18n.load(lang),
      new Promise((_, r) => setTimeout(() => r(new Error('i18n timeout')), 5000)),
    ]).catch(e => console.warn('[i18n] failed:', e.message));

    try { PWAInstall.init(); } catch(e) { console.warn('PWA install init:', e); }

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);
    bindEvents();

    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat;
      state.lon = cached.lon;
      setLocationDisplay(cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
    }

    fetchAndRenderWeather(state.lat, state.lon);

    try { AppMap.init(state.lat, state.lon); }
    catch(e) { console.error('Map init failed:', e); }

    tryGeolocation();
    trackEvent('app_open');

  }

  async function tryGeolocation() {
    setLocationDisplay('Detecting location…');
    try {
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat;
      state.lon = pos.lon;
      GeoHelper.reverseGeocode(pos.lat, pos.lon).then(name => {
        setLocationDisplay(name);
        GeoHelper.saveLocation(pos.lat, pos.lon, name);
      }).catch(() => {});
      fetchAndRenderWeather(state.lat, state.lon);
      AppMap.panTo(state.lat, state.lon);
    } catch {
      const c = GeoHelper.getCached();
      setLocationDisplay(c ? c.name + ' (cached)' : 'London, UK (default)');
    }
  }

  function setLocationDisplay(t) {
    const el = document.getElementById('location-display');
    if (el) el.textContent = t;
  }

  function bindEvents() {
    document.getElementById('theme-toggle')
      ?.addEventListener('click', () => Theme.toggle());
    document.getElementById('lang-selector')
      ?.addEventListener('change', async e => {
        await I18n.load(e.target.value);
        if (state.weatherData) WeatherUI.renderCurrent(state.weatherData.current);
      });
    document.getElementById('find-dry-window')
      ?.addEventListener('click', () => { handleFindDryWindow(); trackEvent('find_dry_window_click'); });
    document.getElementById('refresh-location')
      ?.addEventListener('click', () => tryGeolocation());
    document.getElementById('retry-weather')
      ?.addEventListener('click', () => fetchAndRenderWeather(state.lat, state.lon));
    document.getElementById('toggle-clouds')
      ?.addEventListener('click', () => AppMap.setMode('clouds'));
    document.getElementById('toggle-satellite')
      ?.addEventListener('click', () => AppMap.setMode('satellite'));
  }

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
    } catch(e) {
      console.error('Weather fetch failed:', e);
      UIState.showError('weather');
    }
  }

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
      if (state.weatherData.minutely15?.length) WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      if (state.lat && state.lon) AppMap.panTo(state.lat, state.lon);
    } catch(e) {
      console.error('Dry window error:', e);
      showNoWindowFallback();
    }
  }

  function showNoWindowFallback() {
    UIState.showSection('dry-window-section');
    UIState.setVisible('dry-window-none', true);
    UIState.setVisible('dry-window-result', false);
    UIState.hideSection('dry-window-skeleton');
  }

  function handleOnline()  {
    state.isOnline = true;
    UIState.showOfflineBanner(false);
    if (state.lat) fetchAndRenderWeather(state.lat, state.lon);
  }
  function handleOffline() {
    state.isOnline = false;
    UIState.showOfflineBanner(true);
  }

  function trackEvent(name, props = {}) {
    try { if (typeof window.plausible === 'function') window.plausible(name, { props }); } catch {}
  }

  return { init, state };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
