/* ============================================================
   app.js – Step Out PWA v1.0.4-debug
   ============================================================ */
'use strict';

// ── On-screen debug panel ────────────────────────────────────
const DBG = (() => {
  let list;
  function init() {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:45vh;overflow-y:auto;background:rgba(0,0,0,0.92);color:#0f0;font:12px/1.5 monospace;z-index:99999;padding:8px;border-top:2px solid #0f0';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;font-weight:bold;margin-bottom:4px;color:#fff';
    hdr.innerHTML = 'Step Out Debug <button onclick="this.closest(\'div\').parentElement.remove()" style="background:#555;color:#fff;border:none;padding:2px 8px;cursor:pointer;border-radius:3px">✕</button>';
    list = document.createElement('div');
    panel.appendChild(hdr);
    panel.appendChild(list);
    document.body.appendChild(panel);
  }
  function log(msg, col) {
    console.log('[DBG]', msg);
    if (!list) return;
    const t = new Date().toLocaleTimeString('en',{hour12:false});
    const d = document.createElement('div');
    d.style.color = col || '#0f0';
    d.textContent = `[${t}] ${msg}`;
    list.appendChild(d);
    list.parentElement.scrollTop = 9999;
  }
  return {
    init,
    ok:  m => log('✓ ' + m, '#5f5'),
    err: m => log('✗ ' + m, '#f55'),
    info:m => log('→ ' + m, '#5cf'),
  };
})();

const App = (() => {

  const state = {
    lat: 51.5074,
    lon: -0.1278,
    locationName: '',
    weatherData: null,
    dryWindowResult: null,
    isOnline: navigator.onLine,
    version: '1.0.4-debug',
  };

  async function init() {
    DBG.init();
    DBG.info('init — online:' + navigator.onLine + ' ua:' + navigator.userAgent.slice(0,40));

    // SW status
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        DBG.info('SW registrations: ' + regs.length + (regs.map(r=>' '+r.scope)));
      });
    }

    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    try { Theme.init(); DBG.ok('Theme'); } catch(e) { DBG.err('Theme: '+e.message); }

    // i18n with 3s timeout
    try {
      const lang = I18n.detectLanguage();
      DBG.info('i18n lang: ' + lang);
      await Promise.race([
        I18n.load(lang),
        new Promise((_,r) => setTimeout(() => r(new Error('i18n timeout')), 3000)),
      ]);
      DBG.ok('i18n loaded');
    } catch(e) { DBG.err('i18n: ' + e.message); }

    try { PWAInstall.init(); DBG.ok('PWA'); } catch(e) { DBG.err('PWA: '+e.message); }

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);
    bindEvents();
    DBG.ok('events bound');

    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat; state.lon = cached.lon;
      setLocationDisplay(cached.name);
      DBG.ok('cached loc: ' + cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
      DBG.info('using default: London');
    }

    DBG.info('fetching weather for ' + state.lat.toFixed(3) + ',' + state.lon.toFixed(3));
    fetchAndRenderWeather(state.lat, state.lon);

    try { AppMap.init(state.lat, state.lon); DBG.ok('map init'); }
    catch(e) { DBG.err('map: ' + e.message); }

    tryGeolocation();
    trackEvent('app_open');
  }

  async function tryGeolocation() {
    setLocationDisplay('Detecting location…');
    DBG.info('requesting geolocation…');
    try {
      const pos = await GeoHelper.getPosition();
      state.lat = pos.lat; state.lon = pos.lon;
      DBG.ok('geo: ' + pos.lat.toFixed(4) + ',' + pos.lon.toFixed(4));
      GeoHelper.reverseGeocode(pos.lat, pos.lon).then(name => {
        setLocationDisplay(name);
        GeoHelper.saveLocation(pos.lat, pos.lon, name);
        DBG.ok('geocoded: ' + name);
      }).catch(e => DBG.err('geocode: ' + e.message));
      fetchAndRenderWeather(state.lat, state.lon);
      AppMap.panTo(state.lat, state.lon);
    } catch(e) {
      DBG.err('geo failed: ' + e.message + ' code:' + e.code);
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
      ?.addEventListener('click', () => { DBG.info('find dry window clicked'); handleFindDryWindow(); trackEvent('find_dry_window_click'); });
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
    DBG.info('fetchWeather(' + lat.toFixed(3) + ',' + lon.toFixed(3) + ')');
    UIState.showSkeleton('weather');
    try {
      const data = await WeatherAPI.fetch(lat, lon);
      state.weatherData = data;
      DBG.ok('weather: ' + data.source + ' ' + data.current.temp + '° ' + data.current.emoji + (data.fromCache?' [cache]':''));
      if (data.fromCache || !state.isOnline) UIState.showOfflineBanner(true);
      UIState.setDataSource(data.source);
      WeatherUI.renderCurrent(data.current);
      UIState.showContent('weather');
      DBG.ok('weather rendered');
      if (data.hourly?.length)     WeatherUI.renderHourly(data.hourly);
      if (data.minutely15?.length) { WeatherUI.renderTimeline(data.minutely15, null); DBG.ok('timeline: ' + data.minutely15.length + ' slots'); }
      trackEvent('weather_fetch', { source: data.source });
    } catch(e) {
      DBG.err('weather FAILED: ' + e.message);
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
      DBG.ok('dry window: ' + (result ? result.durationMinutes + 'min score:' + result.score : 'none'));
      WeatherUI.renderDryWindow(result ? DryWindow.formatWindow(result, I18n.getLang()) : null);
      if (state.weatherData.minutely15?.length) WeatherUI.renderTimeline(state.weatherData.minutely15, result);
      if (state.lat && state.lon) AppMap.panTo(state.lat, state.lon);
    } catch(e) { DBG.err('drywindow: ' + e.message); showNoWindowFallback(); }
  }

  function showNoWindowFallback() {
    UIState.showSection('dry-window-section');
    UIState.setVisible('dry-window-none', true);
    UIState.setVisible('dry-window-result', false);
    UIState.hideSection('dry-window-skeleton');
  }

  function handleOnline()  { state.isOnline = true;  UIState.showOfflineBanner(false); DBG.ok('online'); if (state.lat) fetchAndRenderWeather(state.lat, state.lon); }
  function handleOffline() { state.isOnline = false; UIState.showOfflineBanner(true);  DBG.err('offline'); }

  function trackEvent(name, props={}) {
    try { if (typeof window.plausible === 'function') window.plausible(name, { props }); } catch {}
  }

  return { init, state };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
