/* ============================================================
   ui.js – Reusable UI helpers, i18n, theme management
   ============================================================ */

// ============================================================
// Internationalisation (i18n)
// ============================================================
const I18n = (() => {
  let strings = {};
  let currentLang = 'en';

  const SUPPORTED = ['en', 'fr', 'de', 'es'];

  function detectLanguage() {
    const saved = localStorage.getItem('stepout_lang');
    if (saved && SUPPORTED.includes(saved)) return saved;

    const browser = (navigator.language || navigator.userLanguage || 'en').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : 'en';
  }

  async function load(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`lang/${lang}.json?v=1.0.6`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      strings = await res.json();
      currentLang = lang;
      localStorage.setItem('stepout_lang', lang);
      applyToDOM();
    } catch (e) {
      console.warn(`[i18n] Failed to load ${lang}:`, e.message);
      if (lang !== 'en') await load('en');
    }
  }

  function t(key, replacements = {}) {
    let str = strings[key] || key;
    for (const [k, v] of Object.entries(replacements)) {
      str = str.replace(`{${k}}`, v);
    }
    return str;
  }

  function applyToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translation = t(key);
      if (translation !== key) {
        el.textContent = translation;
      }
    });

    // Update <html lang>
    document.documentElement.lang = currentLang;

    // Update lang selector
    const sel = document.getElementById('lang-selector');
    if (sel) sel.value = currentLang;
  }

  function getLang() { return currentLang; }

  return { load, t, applyToDOM, detectLanguage, getLang };
})();

// ============================================================
// Theme management
// ============================================================
const Theme = (() => {
  let current = 'auto';

  function init() {
    const saved = localStorage.getItem('stepout_theme') || 'auto';
    set(saved);
  }

  function set(theme) {
    current = theme;
    const body = document.body;

    body.classList.remove('theme-auto', 'light', 'dark');

    if (theme === 'dark') {
      body.classList.add('dark');
    } else if (theme === 'light') {
      // no extra class needed, default is light
    } else {
      body.classList.add('theme-auto');
    }

    localStorage.setItem('stepout_theme', theme);
    updateIcon();
    updateMeta();
  }

  function toggle() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (current === 'auto') {
      set(isDark ? 'light' : 'dark');
    } else if (current === 'dark') {
      set('light');
    } else {
      set('dark');
    }
  }

  function updateIcon() {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    const effectiveDark = current === 'dark' ||
      (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    icon.textContent = effectiveDark ? '☀️' : '🌙';
  }

  function updateMeta() {
    const meta = document.getElementById('theme-color-meta');
    const effectiveDark = current === 'dark' ||
      (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (meta) meta.setAttribute('content', effectiveDark ? '#1a1830' : '#6366f1');
  }

  function getCurrent() { return current; }

  return { init, set, toggle, getCurrent };
})();

// ============================================================
// Loading / Skeleton helpers
// ============================================================
const UIState = (() => {

  function showSkeleton(sectionId) {
    const skeletonId = sectionId + '-skeleton';
    const contentId = sectionId + '-content';
    const errorId = sectionId + '-error';

    setVisible(skeletonId, true);
    setVisible(contentId, false);
    if (errorId) setVisible(errorId, false);
  }

  function showContent(sectionId) {
    const skeletonId = sectionId + '-skeleton';
    const contentId = sectionId + '-content';
    const errorId = sectionId + '-error';

    setVisible(skeletonId, false);
    setVisible(contentId, true);
    if (errorId) setVisible(errorId, false);

    const content = document.getElementById(contentId);
    if (content) content.classList.add('fade-in');
  }

  function showError(sectionId) {
    const skeletonId = sectionId + '-skeleton';
    const contentId = sectionId + '-content';
    const errorId = sectionId + '-error';

    setVisible(skeletonId, false);
    if (contentId) setVisible(contentId, false);
    setVisible(errorId, true);
  }

  function setVisible(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    if (visible) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function showSection(id) { setVisible(id, true); }
  function hideSection(id) { setVisible(id, false); }

  function showOfflineBanner(show) {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (show) {
      banner.classList.remove('hidden');
      document.body.style.paddingTop = '40px';
    } else {
      banner.classList.add('hidden');
      document.body.style.paddingTop = '';
    }
  }

  function setDataSource(source) {
    const el = document.getElementById('data-source-label');
    if (el) el.textContent = source;
  }

  return {
    showSkeleton, showContent, showError,
    showSection, hideSection, setVisible,
    showOfflineBanner, setDataSource,
  };
})();

// ============================================================
// Weather rendering helpers
// ============================================================
const WeatherUI = (() => {

  function renderCurrent(current) {
    setText('weather-icon', current.emoji);
    document.getElementById('weather-icon')?.setAttribute('aria-label', current.description);
    setText('temp-value', `${current.temp}°`);
    setText('feels-like', `${current.feelsLike}°`);
    setText('humidity', `${current.humidity}%`);
    setText('wind', `${current.windSpeed} km/h`);
    setText('cloud-cover', `${current.cloudCover}%`);
    setText('uv-index', formatUV(current.uvIndex));
    setText('precipitation', `${current.precipitation} mm`);
    setText('condition-text', current.description);

    const now = new Date();
    setText('weather-updated', `${I18n.t('updated')} ${now.toLocaleTimeString(I18n.getLang(), { hour: '2-digit', minute: '2-digit' })}`);
  }

  function renderHourly(hourly) {
    const container = document.getElementById('hourly-scroll');
    if (!container) return;

    container.innerHTML = '';
    const maxItems = Math.min(hourly.length, 12);

    for (let i = 0; i < maxItems; i++) {
      const h = hourly[i];
      const t = new Date(h.time);
      const timeStr = t.toLocaleTimeString(I18n.getLang(), { hour: '2-digit', minute: '2-digit', hour12: false });
      const isDry = (h.precip || 0) < 0.05 && (h.precipProb || 0) < 20;

      const item = document.createElement('div');
      item.className = `hourly-item ${isDry ? 'dry-hour' : 'rain-hour'}`;
      item.innerHTML = `
        <div class="hourly-time">${timeStr}</div>
        <span class="hourly-icon" aria-hidden="true">${h.emoji}</span>
        <div class="hourly-temp">${h.temp}°</div>
        <div class="hourly-rain">${h.precip > 0 ? h.precip.toFixed(1) + 'mm' : '0'}</div>
      `;
      container.appendChild(item);
    }

    UIState.showSection('forecast-section');
  }

  function renderTimeline(minutely15, dryWindow) {
    const container = document.getElementById('timeline-chart');
    if (!container || !minutely15.length) return;

    container.innerHTML = '';

    const maxPrecip = Math.max(...minutely15.map(s => s.precip || 0), 1);
    const windowStart = dryWindow?.startTime?.getTime();
    const windowEnd = dryWindow?.endTime?.getTime();

    minutely15.forEach(slot => {
      const bar = document.createElement('div');
      bar.className = 'timeline-bar';

      const precip = slot.precip || 0;
      const height = precip === 0 ? 10 : Math.max(10, Math.round((precip / maxPrecip) * 60));
      bar.style.height = `${height}px`;

      const slotTime = new Date(slot.time).getTime();
      if (precip < 0.05) {
        bar.classList.add('dry');
        if (windowStart && windowEnd && slotTime >= windowStart && slotTime <= windowEnd) {
          bar.classList.add('highlight');
        }
      } else {
        bar.classList.add('rain');
      }

      const timeStr = new Date(slot.time).toLocaleTimeString(I18n.getLang(), {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      bar.setAttribute('data-tip', `${timeStr}: ${precip.toFixed(2)}mm`);
      bar.setAttribute('title', `${timeStr}: ${precip.toFixed(2)}mm`);

      container.appendChild(bar);
    });

    UIState.showSection('timeline-section');
  }

  function renderDryWindow(formatted) {
    UIState.showSection('dry-window-section');
    const section = document.getElementById('dry-window-section');
    if (section) section.classList.add('card-enter');

    if (!formatted) {
      UIState.setVisible('dry-window-result', false);
      UIState.setVisible('dry-window-none', true);
      UIState.hideSection('dry-window-skeleton');
      return;
    }

    setText('dw-start-time', formatted.startStr);
    setText('dw-end-time', formatted.endStr);
    setText('dw-duration', `${formatted.durationMinutes} min`);
    setText('dw-clouds', `${formatted.cloudCover}%`);
    setText('dw-wind', `${formatted.windSpeed} km/h`);

    const scoreEl = document.getElementById('dw-score');
    if (scoreEl) {
      scoreEl.textContent = formatted.scoreDisplay;
      scoreEl.className = `detail-value ${formatted.scoreClass}`;
    }

    setText('dw-message', formatted.message);

    // Countdown
    const countdown = document.getElementById('dw-countdown');
    if (countdown && formatted.countdownText) {
      countdown.textContent = formatted.countdownText;
      countdown.classList.remove('hidden');
    }

    // Icon by score
    const iconEl = document.getElementById('dw-icon');
    if (iconEl) {
      iconEl.textContent = formatted.score >= 7.5 ? '☀️' : formatted.score >= 5 ? '⛅' : '🌥️';
    }

    UIState.hideSection('dry-window-skeleton');
    UIState.setVisible('dry-window-result', true);
    UIState.setVisible('dry-window-none', false);
  }

  function showDryWindowSkeleton() {
    UIState.showSection('dry-window-section');
    UIState.showSection('dry-window-skeleton');
    UIState.setVisible('dry-window-result', false);
    UIState.setVisible('dry-window-none', false);
  }

  function formatUV(uv) {
    if (uv === undefined || uv === null) return '--';
    if (uv < 3) return `${uv} (Low)`;
    if (uv < 6) return `${uv} (Mod)`;
    if (uv < 8) return `${uv} (High)`;
    return `${uv} (V.High)`;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  return { renderCurrent, renderHourly, renderTimeline, renderDryWindow, showDryWindowSkeleton };
})();

// ============================================================
// Geolocation helpers
// ============================================================
const GeoHelper = (() => {
  const CACHE_KEY = 'stepout_location';

  function getCached() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveLocation(lat, lon, name = '') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lon, name, ts: Date.now() }));
    } catch { /* ignore */ }
  }

  async function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        err => reject(err),
        { timeout: 5000, maximumAge: 300000, enableHighAccuracy: false }
      );
    });
  }

  async function reverseGeocode(lat, lon) {
    // Primary: Geoapify free tier (no key needed for basic usage)
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'StepOut/1.0 (stepout.app)' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Nominatim failed');
      const data = await res.json();
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
      const country = addr.country_code?.toUpperCase() || '';
      return city ? `${city}, ${country}` : `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    } catch {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

  return { getPosition, reverseGeocode, getCached, saveLocation };
})();

// ============================================================
// PWA Install prompt
// ============================================================
const PWAInstall = (() => {
  let deferredPrompt = null;

  function init() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      const dismissed = localStorage.getItem('stepout_pwa_dismissed');
      if (!dismissed) {
        setTimeout(() => showPrompt(), 3000);
      }
    });

    document.getElementById('install-accept')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      hidePrompt();
      if (outcome === 'accepted') {
        console.log('[PWA] User accepted install');
      }
    });

    document.getElementById('install-dismiss')?.addEventListener('click', () => {
      hidePrompt();
      localStorage.setItem('stepout_pwa_dismissed', '1');
    });

    // iOS Safari hint
    if (isIOS() && !isInStandaloneMode()) {
      const dismissed = localStorage.getItem('stepout_pwa_dismissed');
      if (!dismissed) {
        setTimeout(() => showIOSHint(), 3000);
      }
    }
  }

  function showPrompt() {
    const prompt = document.getElementById('install-prompt');
    if (prompt) prompt.classList.remove('hidden');
  }

  function hidePrompt() {
    const prompt = document.getElementById('install-prompt');
    if (prompt) prompt.classList.add('hidden');
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isInStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function showIOSHint() {
    // Update install prompt text for iOS
    const desc = document.querySelector('#install-prompt [data-i18n="install_desc"]');
    if (desc) desc.textContent = 'Tap the Share button, then "Add to Home Screen".';
    const acceptBtn = document.getElementById('install-accept');
    if (acceptBtn) acceptBtn.style.display = 'none';
    showPrompt();
  }

  return { init };
})();

window.I18n = I18n;
window.Theme = Theme;
window.UIState = UIState;
window.WeatherUI = WeatherUI;
window.GeoHelper = GeoHelper;
window.PWAInstall = PWAInstall;
