/* ============================================================
   app.js – Main controller for Step Out PWA
   Orchestrates: geolocation → weather → dry window → UI → map
   ============================================================ */

'use strict';

const App = (() => {

  // App state
  const state = {
    lat: null,
    lon: null,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.0',
  };

  // ============================================================
  // Initialisation
  // ============================================================
  async function init() {
    console.log('[App] Step Out v' + state.version + ' starting...');

    // Set version in footer
    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    // Theme
    Theme.init();

    // Language
    const lang = I18n.detectLanguage();
    await I18n.load(lang);

    // PWA install prompt
    PWAInstall.init();

    // Online/offline detection
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);

    // Wire up controls
    bindEvents();

    // Try to get location and weather immediately
    await startLocationFlow();

    // Analytics
    trackEvent('app_open');
  }

  // ============================================================
  // Event bindings
  // ============================================================
  function bindEvents() {
    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      Theme.toggle();
    });

    // Language selector
    document.getElementById('lang-selector')?.addEventListener('change', async (e) => {
      await I18n.load(e.target.value);
      // Re-render any displayed data with new locale
      if (state.weatherData) {
        WeatherUI.renderCurrent(state.weatherData.current);
      }
      if (state.dryWindowResult) {
        const formatted = DryWindow.formatWindow(state.dryWindowResult, I18n.getLang());
        WeatherUI.renderDryWindow(formatted);
      }
    });

    // Find dry window button
    document.getElementById('find-dry-window')?.addEventListener('click', () => {
      handleFindDryWindow();
      trackEvent('find_dry_window_click');
    });

    // Refresh location
    document.getElementById('refresh-location')?.addEventListener('click', () => {
      startLocationFlow(true);
    });

    // Retry weather
    document.getElementById('retry-weather')?.addEventListener('click', () => {
      if (state.lat && state.lon) fetchAndRenderWeather(state.lat, state.lon);
    });

    // Map controls
    document.getElementById('toggle-clouds')?.addEventListener('click', () => {
      AppMap.setMode('clouds');
    });
    document.getElementById('toggle-satellite')?.addEventListener('click', () => {
      AppMap.setMode('satellite');
    });
  }

  // ============================================================
  // Location flow
  // ============================================================
  async function startLocationFlow(forceRefresh = false) {
    const locationDisplay = document.getElementById('location-display');
    if (locationDisplay) locationDisplay.textContent = I18n.t('detecting_location');

    UIState.showSkeleton('weather');

    try {
      // Try fresh geolocation
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat;
      state.lon = pos.lon;

      // Reverse geocode for display name
      const name = await GeoHelper.reverseGeocode(pos.lat, pos.lon);
      state.locationName = name;
      if (locationDisplay) locationDisplay.textContent = name;

      GeoHelper.saveLocation(pos.lat, pos.lon, name);

    } catch (geoErr) {
      console.warn('[App] Geolocation failed:', geoErr.message);

      // Fall back to cached location
      const cached = GeoHelper.getCached();
      if (cached) {
        state.lat = cached.lat;
        state.lon = cached.lon;
        state.locationName = cached.name;
        if (locationDisplay) locationDisplay.textContent = cached.name + ' (cached)';
      } else {
        // Default fallback: London, UK
        state.lat = 51.5074;
        state.lon = -0.1278;
        state.locationName = 'London, GB (default)';
        if (locationDisplay) locationDisplay.textContent = state.locationName;
        console.warn('[App] Using default location: London');
      }
    }

    // Fetch weather
    await fetchAndRenderWeather(state.lat, state.lon);

    // Init map
    AppMap.init(state.lat, state.lon);
    AppMap.invalidate();
  }

  // ============================================================
  // Weather fetch & render
  // ============================================================
  async function fetchAndRenderWeather(lat, lon) {
    UIState.showSkeleton('weather');

    try {
      const data = await WeatherAPI.fetch(lat, lon);
      state.weatherData = data;

      // Show cache/offline notice if needed
      if (data.fromCache || !state.isOnline) {
        UIState.showOfflineBanner(true);
      }

      UIState.setDataSource(data.source);
      WeatherUI.renderCurrent(data.current);
      UIState.showContent('weather');

      // Render hourly forecast
      if (data.hourly?.length) {
        WeatherUI.renderHourly(data.hourly);
      }

      // Render precipitation timeline
      if (data.minutely15?.length) {
        WeatherUI.renderTimeline(data.minutely15, null);
      }

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
    if (!state.weatherData?.minutely15?.length) {
      // Re-fetch first
      await fetchAndRenderWeather(state.lat, state.lon);
      if (!state.weatherData?.minutely15?.length) {
        showNoWindowFallback();
        return;
      }
    }

    WeatherUI.showDryWindowSkeleton();

    // Small delay for UX feel
    await sleep(400);

    try {
      const result = DryWindow.findDryWindow(state.weatherData.minutely15, 10);
      state.dryWindowResult = result;

      const formatted = result
        ? DryWindow.formatWindow(result, I18n.getLang())
        : null;

      WeatherUI.renderDryWindow(formatted);

      // Update timeline with window highlight
      if (state.weatherData.minutely15?.length) {
        WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      }

      // Animate map pan to show location
      if (state.lat && state.lon) {
        AppMap.panTo(state.lat, state.lon);
      }

    } catch (err) {
      console.error('[App] Dry window calc error:', err);
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
  // Online/offline handlers
  // ============================================================
  function handleOnline() {
    state.isOnline = true;
    UIState.showOfflineBanner(false);
    // Refresh if we have location
    if (state.lat && state.lon) {
      fetchAndRenderWeather(state.lat, state.lon);
    }
  }

  function handleOffline() {
    state.isOnline = false;
    UIState.showOfflineBanner(true);
  }

  // ============================================================
  // Plausible Analytics (privacy-safe, no PII)
  // ============================================================
  function trackEvent(name, props = {}) {
    try {
      if (typeof window.plausible === 'function') {
        window.plausible(name, { props });
      }
    } catch { /* ignore */ }
  }

  // ============================================================
  // Utility
  // ============================================================
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  return { init, state };
})();

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
