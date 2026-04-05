/* ============================================================
   app.js – Main controller for Step Out PWA (debug build)
   ============================================================ */

'use strict';

// ---- Tiny on-screen debug log (helps debug on mobile) --------
const DBG = (() => {
  let panel, list;

  function init() {
    panel = document.createElement('div');
    panel.id = 'dbg-panel';
    panel.style.cssText = [
      'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow-y:auto',
      'background:rgba(0,0,0,0.85);color:#0f0;font:11px/1.4 monospace',
      'z-index:9999;padding:6px;border-top:2px solid #0f0',
    ].join(';');

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px';
    hdr.innerHTML = '<strong>Step Out Debug</strong><button id="dbg-close" style="background:#333;color:#fff;border:none;padding:2px 8px;cursor:pointer">✕</button>';
    panel.appendChild(hdr);

    list = document.createElement('div');
    panel.appendChild(list);
    document.body.appendChild(panel);
    document.getElementById('dbg-close').addEventListener('click', () => panel.remove());
  }

  function log(msg, color = '#0f0') {
    console.log('[DBG]', msg);
    if (!list) return;
    const t = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = document.createElement('div');
    row.style.color = color;
    row.textContent = `[${t}] ${msg}`;
    list.appendChild(row);
    panel.scrollTop = panel.scrollHeight;
  }

  function err(msg) { log('✗ ' + msg, '#f55'); }
  function ok(msg)  { log('✓ ' + msg, '#5f5'); }
  function info(msg){ log('→ ' + msg, '#5cf'); }

  return { init, log, err, ok, info };
})();

// --------------------------------------------------------------

const App = (() => {

  const state = {
    lat: 51.5074,
    lon: -0.1278,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.1-debug',
  };

  async function init() {
    DBG.init();
    DBG.info('App init — online: ' + navigator.onLine);

    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    // Theme
    try { Theme.init(); DBG.ok('Theme OK'); }
    catch(e) { DBG.err('Theme: ' + e.message); }

    // Language — give it 3s max, then continue regardless
    try {
      const lang = I18n.detectLanguage();
      DBG.info('Lang detected: ' + lang);
      await Promise.race([
        I18n.load(lang),
        new Promise((_, rej) => setTimeout(() => rej(new Error('i18n timeout')), 3000))
      ]);
      DBG.ok('i18n loaded: ' + lang);
    } catch(e) { DBG.err('i18n: ' + e.message + ' — continuing anyway'); }

    // PWA
    try { PWAInstall.init(); DBG.ok('PWA init OK'); }
    catch(e) { DBG.err('PWA: ' + e.message); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);

    bindEvents();
    DBG.ok('Events bound');

    // Use cached or default location immediately
    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat;
      state.lon = cached.lon;
      state.locationName = cached.name;
      setLocationDisplay(cached.name);
      DBG.ok('Cached location: ' + cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
      DBG.info('No cached loc, using London default');
    }

    // Fetch weather immediately
    DBG.info('Starting weather fetch for ' + state.lat + ',' + state.lon);
    fetchAndRenderWeather(state.lat, state.lon);

    // Init map
    try {
      AppMap.init(state.lat, state.lon);
      DBG.ok('Map init OK');
    } catch(e) { DBG.err('Map init: ' + e.message); }

    // Geolocation in background
    tryGeolocation();

    trackEvent('app_open');
  }

  async function tryGeolocation() {
    setLocationDisplay(I18n.t('detecting_location'));
    DBG.info('Requesting geolocation...');
    try {
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat;
      state.lon = pos.lon;
      DBG.ok('Geo: ' + pos.lat.toFixed(4) + ',' + pos.lon.toFixed(4));

      GeoHelper.reverseGeocode(pos.lat, pos.lon).then(name => {
        state.locationName = name;
        setLocationDisplay(name);
        GeoHelper.saveLocation(pos.lat, pos.lon, name);
        DBG.ok('Geocoded: ' + name);
      }).catch(e => DBG.err('Geocode: ' + e.message));

      fetchAndRenderWeather(state.lat, state.lon);
      AppMap.panTo(state.lat, state.lon);

    } catch (err) {
      DBG.err('Geo failed: ' + err.message + ' (code ' + err.code + ')');
      const cached = GeoHelper.getCached();
      setLocationDisplay(cached ? cached.name + ' (cached)' : 'London, UK (default)');
    }
  }

  function setLocationDisplay(text) {
    const el = document.getElementById('location-display');
    if (el) el.textContent = text;
  }

  function bindEvents() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => Theme.toggle());

    document.getElementById('lang-selector')?.addEventListener('change', async (e) => {
      await I18n.load(e.target.value);
      if (state.weatherData) WeatherUI.renderCurrent(state.weatherData.current);
      if (state.dryWindowResult)
        WeatherUI.renderDryWindow(DryWindow.formatWindow(state.dryWindowResult, I18n.getLang()));
    });

    document.getElementById('find-dry-window')?.addEventListener('click', () => {
      DBG.info('Find dry window clicked');
      handleFindDryWindow();
      trackEvent('find_dry_window_click');
    });

    document.getElementById('refresh-location')?.addEventListener('click', () => tryGeolocation());

    document.getElementById('retry-weather')?.addEventListener('click', () => {
      DBG.info('Retry weather clicked');
      fetchAndRenderWeather(state.lat, state.lon);
    });

    document.getElementById('toggle-clouds')?.addEventListener('click', () => AppMap.setMode('clouds'));
    document.getElementById('toggle-satellite')?.addEventListener('click', () => AppMap.setMode('satellite'));
  }

  async function fetchAndRenderWeather(lat, lon) {
    DBG.info('fetchWeather(' + lat.toFixed(3) + ',' + lon.toFixed(3) + ')');
    UIState.showSkeleton('weather');

    try {
      const data = await WeatherAPI.fetch(lat, lon);
      state.weatherData = data;
      DBG.ok('Weather OK — source: ' + data.source + (data.fromCache ? ' [cache]' : ''));

      if (data.fromCache || !state.isOnline) UIState.showOfflineBanner(true);

      UIState.setDataSource(data.source);
      WeatherUI.renderCurrent(data.current);
      UIState.showContent('weather');
      DBG.ok('Weather rendered — ' + data.current.temp + '° ' + data.current.emoji);

      if (data.hourly?.length) {
        WeatherUI.renderHourly(data.hourly);
        DBG.ok('Hourly rendered (' + data.hourly.length + ' slots)');
      }
      if (data.minutely15?.length) {
        WeatherUI.renderTimeline(data.minutely15, null);
        DBG.ok('Timeline rendered (' + data.minutely15.length + ' slots)');
      }

      trackEvent('weather_fetch', { source: data.source });

    } catch (err) {
      DBG.err('Weather FAILED: ' + err.message);
      UIState.showError('weather');
    }
  }

  async function handleFindDryWindow() {
    if (!state.weatherData?.minutely15?.length) {
      DBG.info('No weather data — fetching first');
      WeatherUI.showDryWindowSkeleton();
      await fetchAndRenderWeather(state.lat, state.lon);
      if (!state.weatherData?.minutely15?.length) {
        DBG.err('Still no weather data after fetch');
        showNoWindowFallback();
        return;
      }
    }

    WeatherUI.showDryWindowSkeleton();
    await sleep(350);

    try {
      const result = DryWindow.findDryWindow(state.weatherData.minutely15, 10);
      state.dryWindowResult = result;
      DBG.ok('Dry window: ' + (result ? result.durationMinutes + 'min, score ' + result.score : 'none found'));

      WeatherUI.renderDryWindow(result ? DryWindow.formatWindow(result, I18n.getLang()) : null);
      if (state.weatherData.minutely15?.length)
        WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      if (state.lat && state.lon) AppMap.panTo(state.lat, state.lon);

    } catch (err) {
      DBG.err('DryWindow error: ' + err.message);
      showNoWindowFallback();
    }
  }

  function showNoWindowFallback() {
    UIState.showSection('dry-window-section');
    UIState.setVisible('dry-window-none', true);
    UIState.setVisible('dry-window-result', false);
    UIState.hideSection('dry-window-skeleton');
  }

  function handleOnline() {
    state.isOnline = true;
    UIState.showOfflineBanner(false);
    DBG.ok('Back online');
    if (state.lat && state.lon) fetchAndRenderWeather(state.lat, state.lon);
  }

  function handleOffline() {
    state.isOnline = false;
    UIState.showOfflineBanner(true);
    DBG.err('Gone offline');
  }

  function trackEvent(name, props = {}) {
    try { if (typeof window.plausible === 'function') window.plausible(name, { props }); }
    catch { /* ignore */ }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { init, state };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
