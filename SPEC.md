# Step Out – App Specification

**Version:** 1.0.0
**Last Updated:** 2026-03-18
**Status:** MVP Complete

---

## 1. Product Overview

**Step Out** is a Progressive Web App (PWA) that helps users find the next dry gap in rainy weather — specifically a minimum 10-minute window suitable for going outside.

**Tagline:** "Find Your Dry 10 Minutes."

### Core Value Proposition

1. When is the **next dry 10-minute window** in the next 1–3 hours?
2. How long does that window last?
3. What will the weather feel like during the window?
4. Real-time cloud imagery on a map
5. Works offline with cached data
6. Installable as a native-feeling app (PWA)

---

## 2. Architecture

### 2.1 Deployment

- **Platform:** GitHub Pages (static hosting)
- **Architecture:** Zero-backend, client-only
- **Build system:** None (vanilla HTML/CSS/JS)
- **PWA:** Service worker with offline caching

### 2.2 File Structure

```
stepout/
├── index.html              App shell + layout
├── style.css               Styles (mobile-first, glassmorphism)
├── app.js                  Main app controller
├── sw.js                   Service worker
├── manifest.json           PWA manifest
├── offline.html            Offline fallback
├── assets/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── logo.png
├── libs/
│   ├── leaflet.js          v1.9.4
│   ├── leaflet.css
│   └── images/             Leaflet markers
├── lang/
│   ├── en.json
│   ├── fr.json
│   ├── de.json
│   └── es.json
└── components/
    ├── ui.js               i18n + theme + UI helpers + PWA install
    ├── weather.js          Weather API + fallback chain
    ├── drywindow.js        Dry window algorithm
    └── map.js              Leaflet + NASA GIBS map
```

---

## 3. APIs

### 3.1 Weather API Fallback Chain

| Priority | Source | API Key | Coverage |
|----------|--------|---------|----------|
| 1 (Primary) | Open-Meteo | None | Global |
| 2 (Fallback 1) | MET Norway | None (User-Agent required) | Global |
| 3 (Fallback 2) | OpenWeatherMap | Required (free tier) | Global |
| 4 (Fallback 3) | Cached data | N/A | Last known location |
| 5 (Final) | Error screen | N/A | N/A |

**Open-Meteo data used:**
- `current`: temperature_2m, apparent_temperature, precipitation, weather_code, cloud_cover, wind_speed_10m, wind_direction_10m, relative_humidity_2m, uv_index
- `hourly`: temperature_2m, precipitation_probability, precipitation, weather_code, cloud_cover, wind_speed_10m, uv_index (24h)
- `minutely_15`: precipitation, weather_code, wind_speed_10m, cloud_cover (next 3h = 12 slots)

### 3.2 Geocoding

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | OSM Nominatim | Reverse geocoding, free |
| Fallback | Coordinate display | lat/lon as string |

### 3.3 Map Tiles

| Layer | Source | Notes |
|-------|--------|-------|
| Base | OpenStreetMap | Always available |
| Cloud overlay | NASA GIBS (MODIS Aqua) | Optional, fails gracefully |
| Satellite | Esri World Imagery | Manual toggle |

---

## 4. Core Algorithm – Dry Window Finder

**File:** `components/drywindow.js`

### 4.1 Input
- Array of 15-minute precipitation intervals for next 3 hours (12 slots)
- Each slot: `{ time, precip, windSpeed, cloudCover, uvIndex? }`

### 4.2 Processing Steps

1. **Mark dry intervals** — `precip < 0.05 mm` = dry
2. **Group consecutive dry slots** into windows
3. **Filter** — keep windows ≥ 10 minutes (≥ 1 slot at 15-min resolution)
4. **Score each window** using weighted formula:
   - Cloud cover score (35% weight): `max(0, 10 - cloudCover/10)`
   - Wind speed score (25% weight): 10 if <15km/h, 7 if <30, 4 if <50, else 1
   - Precipitation score (30% weight): 10 if 0mm, 6 if <0.1mm, else 2
   - UV score (10% weight): 7 if <3, 10 if <6, 8 if <9, else 5
5. **Sort** — prefer early windows (within 90 min) with high scores
6. **Return** best window with: start_time, end_time, duration_minutes, score, cloud_cover, wind_speed, sarcastic_message

### 4.3 Output Format
```js
{
  startTime: Date,
  endTime: Date,
  durationMinutes: Number,
  score: Number (0-10),
  cloudCover: Number (%),
  windSpeed: Number (km/h),
  message: String (sarcastic),
  intervals: Array,
  allWindows: Array
}
```

### 4.4 Sarcastic Messages

| Score | Category | Example |
|-------|----------|---------|
| ≥ 7.5 | excellent | "Perfect conditions. No excuses now." |
| ≥ 5.5 | good | "Not bad. A light jacket might help." |
| ≥ 3.5 | fair | "It's dryish. Dress accordingly." |
| < 3.5 | minimal | "You've got a narrow gap. Use it or lose it." |

---

## 5. UI Design

### 5.1 Layout
- **Mobile-first** single column layout
- Max-width 640px, centered
- Safe area insets for notched phones

### 5.2 Design System
- **Glassmorphism** cards: `backdrop-filter: blur(16px)`, semi-transparent backgrounds
- **Primary colour:** `#6366f1` (Indigo)
- **Accent colour:** `#8b5cf6` (Purple)
- **Success:** `#22c55e`, **Warning:** `#f59e0b`, **Danger:** `#ef4444`
- **Fonts:** System font stack (`-apple-system, BlinkMacSystemFont, Segoe UI`)
- **Animations:** fade-in, card-enter, pulse-glow (CTA button), shimmer (skeletons)

### 5.3 Themes
- **Auto** (default): follows `prefers-color-scheme`
- **Light:** White/indigo surfaces
- **Dark:** Deep navy/purple surfaces
- Toggled via header button, persisted in localStorage

### 5.4 Sections (top to bottom)
1. **Offline banner** (conditional, fixed top)
2. **Header**: Logo + tagline + language selector + theme toggle
3. **Location bar**: Current location name + refresh button
4. **Current weather card**: Temp, feels like, humidity, wind, cloud, UV, rain
5. **CTA button**: "Find My Dry Window"
6. **Dry window result card** (appears after CTA clicked)
7. **Precipitation timeline** (15-min bar chart, 3h)
8. **Map** (Leaflet + NASA GIBS cloud layer)
9. **Hourly forecast scroll** (12 hours, horizontal)
10. **Footer**: Attribution + version

---

## 6. PWA Specification

### 6.1 Manifest
- `display: standalone`
- `orientation: portrait`
- Icons: 192×192 and 512×512 PNG
- `theme_color: #6366f1`
- Shortcut: "Find Dry Window"

### 6.2 Service Worker (sw.js)

| Cache Name | Strategy | Contents |
|------------|----------|----------|
| `stepout-static-{version}` | Cache-first | All static assets, HTML, JS, CSS |
| `stepout-api-{version}` | Network-first (2h grace) | Weather API responses |
| `stepout-dynamic-{version}` | Cache-first | Map tiles, dynamic assets |

**Cache TTL:** API responses cached for 30 min (grace period 2h when offline)

### 6.3 Offline Behaviour
- Static assets always served from cache
- API: network-first, falls back to cached response (up to 2h old)
- Map tiles: cache-first (tiles rarely change)
- Navigation requests: serve `offline.html` if network fails

### 6.4 Install Prompt
- Android/Chrome: Native `beforeinstallprompt` intercepted, custom prompt shown after 3s
- iOS Safari: Custom hint shown ("Tap Share → Add to Home Screen")
- Dismissed state persisted in localStorage

---

## 7. Internationalisation

**Supported languages:**
- `en` (English) – default
- `fr` (French)
- `de` (German)
- `es` (Spanish)

**Detection order:**
1. `localStorage.stepout_lang` (manual override)
2. `navigator.language` (browser language)
3. Fallback to `en`

**String files:** `/lang/{code}.json` — flat key-value JSON

---

## 8. Analytics

**Provider:** Plausible Analytics (privacy-safe, GDPR compliant, no cookies)

**Tracked events:**
| Event | Trigger |
|-------|---------|
| `app_open` | App initialisation |
| `weather_fetch` | Successful weather data fetch (with `source` prop) |
| `find_dry_window_click` | CTA button clicked |

---

## 9. Browser/Device Support

| Browser | Support |
|---------|---------|
| Chrome/Chromium 90+ | Full (including PWA install) |
| Safari/iOS 14+ | Full (except install prompt – custom hint shown) |
| Firefox 90+ | Full (no install prompt support) |
| Edge 90+ | Full |
| Samsung Internet | Full |

**Minimum requirements:** ES2018, Fetch API, Service Workers, CSS custom properties

---

## 10. Performance Targets

| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 2.5s |
| Offline load time | < 500ms (from cache) |
| Bundle size | < 200KB (excluding Leaflet) |
| Leaflet (included) | ~150KB JS + 15KB CSS |

---

## 11. Known Limitations (v1.0.0)

1. **15-min resolution** – Open-Meteo minutely_15 data means windows are in 15-min increments
2. **3h forecast horizon** – Dry window search limited to next 3 hours
3. **No push notifications** – "Notify me when window opens" not implemented yet
4. **Single location** – No saved locations / favourites
5. **OWM key required** – 3rd-level fallback needs user-configured API key

---

## 12. Changelog

### v1.0.0 – 2026-03-18
- Initial MVP release
- Full PWA with service worker and offline support
- Open-Meteo + MET Norway + OWM fallback chain
- Dry window algorithm with scoring and sarcastic messages
- Leaflet map with NASA GIBS cloud layer
- 4-language support (EN/FR/DE/ES)
- Light/dark theme with auto-detection
- Plausible analytics integration
- Precipitation timeline bar chart
- Hourly forecast horizontal scroll
- PWA install prompts (Android + iOS)
