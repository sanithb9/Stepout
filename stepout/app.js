/* ============================================================
   app.js – Step Out PWA v1.0.5-debug
   ============================================================ */
'use strict';

// ── On-screen debug panel ────────────────────────────────────
const DBG = (() => {
  let list;
  function init() {
    const panel = document.createElement('div');
    // Sit above the reset bar (reset bar is 34px tall)
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow-y:auto;background:rgba(0,0,0,0.93);color:#0f0;font:12px/1.5 monospace;z-index:99998;padding:8px 8px 8px 8px;border-top:2px solid #0f0';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;font-weight:bold;margin-bottom:4px;color:#fff';
    hdr.innerHTML = 'Step Out Debug v1.0.5 <button onclick="this.closest(\'div\').parentElement.remove()" style="background:#555;color:#fff;border:none;padding:2px 8px;cursor:pointer;border-radius:3px">✕</button>';
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
    version: '1.0.5-debug',
  };

  async function init() {
    DBG.init();

    // Immediately flush any boot errors captured by inline script
    if (window.__bootErrors && window.__bootErrors.length) {
      window.__bootErrors.forEach(e => DBG.err('BOOT: ' + e));
    }

    DBG.info('app.js v1.0.5 running');
    DBG.info('html ver: ' + (window.__STEPOUT_HTML_VER || 'UNKNOWN — old SW serving cached index.html'));
    DBG.info('online:' + navigator.onLine + ' ua:' + navigator.userAgent.slice(0,50));

    // Update reset bar status
    const bootSt = document.getElementById('__boot-status');
    if (bootSt) bootSt.textContent = 'app.js v1.0.5 running';

    // Heartbeat — proves the event loop is alive every second for 12s
    let hbCount = 0;
    const hbTimer = setInterval(() => {
      hbCount++;
      DBG.info('heartbeat ' + hbCount + 's');
      if (hbCount >= 12) clearInterval(hbTimer);
    }, 1000);

    // SW status
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        const scopes = regs.map(r => r.scope.replace(location.origin,''));
        DBG.info('SW regs: ' + regs.length + ' ' + scopes.join(' '));
        regs.forEach(r => {
          const sw = r.installing || r.waiting || r.active;
          if (sw) DBG.info('SW state: ' + sw.state + ' scope:' + r.scope.replace(location.origin,''));
        });
      });
    }

    const verEl = document.getElementById('version-info');
    if (verEl) verEl.textContent = 'v' + state.version;

    try { Theme.init(); DBG.ok('Theme'); } catch(e) { DBG.err('Theme: '+e.message); }

    // ── i18n: NON-BLOCKING ─────────────────────────────────
    // Do NOT await — if SW deadlocks the fetch, the rest of the app still loads.
    const lang = (() => { try { return I18n.detectLanguage(); } catch(e) { DBG.err('detectLang: '+e.message); return 'en'; } })();
    DBG.info('i18n lang: ' + lang + ' (loading in background, not blocking)');

    // Start the fetch but don't await it here
    const i18nPromise = Promise.race([
      I18n.load(lang),
      new Promise((_,r) => {
        setTimeout(() => {
          DBG.err('i18n TIMEOUT after 4s — fetch hung (likely stale SW). Tap Reset App!');
          r(new Error('i18n timeout'));
        }, 4000);
      }),
    ]).then(() => {
      DBG.ok('i18n loaded: ' + lang);
    }).catch(e => {
      DBG.err('i18n failed: ' + e.message);
    });

    // ── Continue immediately without waiting for i18n ─────
    DBG.info('skipping i18n await — continuing boot');

    try { PWAInstall.init(); DBG.ok('PWA'); } catch(e) { DBG.err('PWA: '+e.message); }

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    UIState.showOfflineBanner(!navigator.onLine);
    DBG.ok('events: online/offline');
    bindEvents();
    DBG.ok('events: UI bound');

    const cached = GeoHelper.getCached();
    if (cached) {
      state.lat = cached.lat; state.lon = cached.lon;
      setLocationDisplay(cached.name);
      DBG.ok('cached loc: ' + cached.name);
    } else {
      setLocationDisplay('London, UK (default)');
      DBG.info('default: London');
    }

    DBG.info('fetchWeather(' + state.lat.toFixed(3) + ',' + state.lon.toFixed(3) + ')');
    fetchAndRenderWeather(state.lat, state.lon);

    DBG.info('map init…');
    try { AppMap.init(state.lat, state.lon); DBG.ok('map init OK'); }
    catch(e) { DBG.err('map: ' + e.message); }

    tryGeolocation();
    trackEvent('app_open');

    // After 5s, hide the reset bar if everything seems fine
    // (user can still tap it if needed)
    setTimeout(() => {
      const bar = document.getElementById('__reset-bar');
      if (bar && state.weatherData) {
        bar.style.opacity = '0.4';
        bar.style.fontSize = '11px';
      }
    }, 5000);
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
