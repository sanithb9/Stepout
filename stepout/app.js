/* ============================================================
   app.js – Main controller for Step Out PWA
   ============================================================ */

'use strict';

const App = (() => {

  const state = {
    lat: 51.5074,   // Default: London (overwritten once geo resolves)
    lon: -0.1278,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.1',
  };

  // ============================================================
  // Initialisation
  // ============================================================
  async function init() {
    console.log('[App] Step Out v' + state.version + ' starting...');

    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    Theme.init();

    const lang = I18n.detectLanguage();
    await I18n.load(lang);

    PWAInstall.init();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);

    bindEvents();

    // Step 1: Load with cached or default location immediately — no waiting
    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat;
      state.lon = cached.lon;
      state.locationName = cached.name;
      setLocationDisplay(cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
    }

    // Step 2: Fetch weather + init map right away with what we have
    fetchAndRenderWeather(state.lat, state.lon);
    AppMap.init(state.lat, state.lon);

    // Step 3: Try geolocation in the background — update if we get it
    tryGeolocation();

    trackEvent('app_open');
  }

  // ============================================================
  // Geolocation — runs in background, updates state when ready
  // ============================================================
  async function tryGeolocation() {
    setLocationDisplay(I18n.t('detecting_location'));
    try {
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat;
      state.lon = pos.lon;

      // Reverse geocode (non-blocking)
      GeoHelper.reverseGeocode(pos.lat, pos.lon).then(name => {
        state.locationName = name;
        setLocationDisplay(name);
        GeoHelper.saveLocation(pos.lat, pos.lon, name);
      });

      // Refresh weather with real location
      fetchAndRenderWeather(state.lat, state.lon);
      AppMap.panTo(state.lat, state.lon);

    } catch (err) {
      console.warn('[App] Geolocation unavailable:', err.message);
      const cached = GeoHelper.getCached();
      setLocationDisplay(cached ? cached.name + ' (cached)' : 'London, UK (default)');
    }
  }

  function setLocationDisplay(text) {
    const el = document.getElementById('location-display');
    if (el) el.textContent = text;
  }

  // ============================================================
  // Event bindings
  // ============================================================
  function bindEvents() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      Theme.toggle();
    });

    document.getElementById('lang-selector')?.addEventListener('change', async (e) => {
      await I18n.load(e.target.value);
      if (state.weatherData) WeatherUI.renderCurrent(state.weatherData.current);
      if (state.dryWindowResult) {
        WeatherUI.renderDryWindow(DryWindow.formatWindow(state.dryWindowResult, I18n.getLang()));
      }
    });

    document.getElementById('find-dry-window')?.addEventListener('click', () => {
      handleFindDryWindow();
      trackEvent('find_dry_window_click');
    });

    document.getElementById('refresh-location')?.addEventListener('click', () => {
      tryGeolocation();
    });

    document.getElementById('retry-weather')?.addEventListener('click', () => {
      fetchAndRenderWeather(state.lat, state.lon);
    });

    document.getElementById('toggle-clouds')?.addEventListener('click', () => {
      AppMap.setMode('clouds');
    });
    document.getElementById('toggle-satellite')?.addEventListener('click', () => {
      AppMap.setMode('satellite');
    });
  }

  // ============================================================
  // Weather fetch & render
  // ============================================================
  async function fetchAndRenderWeather(lat, lon) {
    UIState.showSkeleton('weather');

    try {
      const data = await WeatherAPI.fetch(lat, lon);
      state.weatherData = data;

      if (data.fromCache || !state.isOnline) {
        UIState.showOfflineBanner(true);
      }

      UIState.setDataSource(data.source);
      WeatherUI.renderCurrent(data.current);
      UIState.showContent('weather');

      if (data.hourly?.length) WeatherUI.renderHourly(data.hourly);
      if (data.minutely15?.length) WeatherUI.renderTimeline(data.minutely15, null);

      trackEvent('weather_fetch', { source: data.source });

    } catch (err) {
      console.error('[App] Weather fetch failed:', err);
      UIState.showError('weather');
    }
  }

  // ============================================================
  // Find Dry Window
  // ============================================================
  async function handleFindDryWindow() {
    // If no weather data yet, fetch first
    if (!state.weatherData?.minutely15?.length) {
      WeatherUI.showDryWindowSkeleton();
      await fetchAndRenderWeather(state.lat, state.lon);
      if (!state.weatherData?.minutely15?.length) {
        showNoWindowFallback();
        return;
      }
    }

    WeatherUI.showDryWindowSkeleton();
    await sleep(350);

    try {
      const result = DryWindow.findDryWindow(state.weatherData.minutely15, 10);
      state.dryWindowResult = result;

      WeatherUI.renderDryWindow(
        result ? DryWindow.formatWindow(result, I18n.getLang()) : null
      );

      if (state.weatherData.minutely15?.length) {
        WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      }

      if (state.lat && state.lon) AppMap.panTo(state.lat, state.lon);

    } catch (err) {
      console.error('[App] Dry window error:', err);
      showNoWindowFallback();
    }
  }

  function showNoWindowFallback() {
    UIState.showSection('dry-window-section');
    UIState.setVisible('dry-window-none', true);
    UIState.setVisible('dry-window-result', false);
    UIState.hideSection('dry-window-skeleton');
  }

  // ============================================================
  // Online / offline
  // ============================================================
  function handleOnline() {
    state.isOnline = true;
    UIState.showOfflineBanner(false);
    if (state.lat && state.lon) fetchAndRenderWeather(state.lat, state.lon);
  }

  function handleOffline() {
    state.isOnline = false;
    UIState.showOfflineBanner(true);
  }

  // ============================================================
  // Analytics
  // ============================================================
  function trackEvent(name, props = {}) {
    try {
      if (typeof window.plausible === 'function') window.plausible(name, { props });
    } catch { /* ignore */ }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { init, state };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
