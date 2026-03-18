# Step Out – Find Your Dry 10 Minutes

> Real-time rain gap finder. Because sometimes you just need to go outside.

## Overview

**Step Out** is a Progressive Web App (PWA) that tells you exactly when you have a dry window in the next 1–3 hours. No fluff, no complex forecasts — just "here's your gap, go."

## Features

- **Dry Window Algorithm** – Finds the best consecutive dry interval in your 3-hour forecast
- **Multi-API Fallback** – Open-Meteo → MET Norway → OpenWeatherMap → Cached data
- **Cloud Map** – NASA GIBS satellite imagery + OpenStreetMap via Leaflet.js
- **PWA** – Install on iOS/Android, works offline with cached forecasts
- **Multilingual** – English, French, German, Spanish (auto-detected)
- **Dark Mode** – Auto-detects system preference + manual toggle
- **Privacy-Safe Analytics** – Plausible (no cookies, no PII)

## Tech Stack

- Vanilla HTML/CSS/JS — zero frameworks, zero build tools
- [Open-Meteo](https://open-meteo.com) – Free minute-level precipitation API
- [MET Norway](https://api.met.no) – Fallback weather API
- [Leaflet.js](https://leafletjs.com) v1.9.4 – Map rendering
- [NASA GIBS](https://earthdata.nasa.gov/gibs) – Cloud/satellite tiles
- [Plausible](https://plausible.io) – Privacy-safe analytics

---

## Running Locally

### Option 1: Python HTTP Server (recommended)

```bash
cd stepout
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080)

> **Note:** Service workers require either `localhost` or HTTPS. A local HTTP server on localhost works fine.

### Option 2: Node.js (if you have it)

```bash
npx serve stepout
```

### Option 3: VS Code Live Server

Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) and click "Go Live".

---

## Deploying to GitHub Pages

### First-time setup

1. Push the repo to GitHub
2. Go to **Settings → Pages**
3. Set **Source** to the branch containing your files
4. Set folder to `/stepout` (or root if stepout is root)
5. Save – your app will be live at `https://<username>.github.io/<repo>/stepout/`

### Automated deploy (GitHub Actions)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./stepout
```

---

## Updating the PWA Cache

When you make changes to the app and want users to get the new version:

1. Bump `CACHE_VERSION` in `sw.js`:
   ```js
   const CACHE_VERSION = 'v1.0.1'; // increment this
   ```
2. Also update the `?v=` query string in `sw.js` `PRECACHE_ASSETS` if needed
3. Commit and push — the new service worker will automatically replace the old one on next visit

---

## File Structure

```
stepout/
├── index.html              Main app shell
├── style.css               Mobile-first styles, dark mode, glassmorphism
├── app.js                  Main controller
├── sw.js                   Service worker (caching + offline)
├── manifest.json           PWA manifest
├── offline.html            Offline fallback page
├── assets/
│   ├── icon-192.png        PWA icon (192×192)
│   ├── icon-512.png        PWA icon (512×512)
│   └── logo.png            App logo
├── libs/
│   ├── leaflet.js          Leaflet.js v1.9.4
│   ├── leaflet.css         Leaflet styles
│   └── images/             Leaflet marker images
├── lang/
│   ├── en.json             English strings
│   ├── fr.json             French strings
│   ├── de.json             German strings
│   └── es.json             Spanish strings
└── components/
    ├── ui.js               i18n, theme, UI helpers, PWA install
    ├── weather.js          API calls + fallback chain
    ├── drywindow.js        Core dry-window algorithm
    └── map.js              Leaflet + NASA GIBS map
```

---

## Configuration

### OpenWeatherMap API Key (optional fallback)

Add this before your script tags in `index.html`:

```html
<script>window.STEPOUT_OWM_KEY = 'your_key_here';</script>
```

### Plausible Analytics

Replace `stepout.app` in `index.html` with your actual domain:

```html
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

---

## iOS Porting Notes

The app is architected for easy iOS porting:

- All API logic is in `components/weather.js` (easy to swap for native calls)
- All UI state is managed without frameworks (easy to map to SwiftUI)
- i18n strings are in `/lang/*.json` (reuse directly)
- The dry window algorithm in `components/drywindow.js` is pure JS (trivially portable)

---

## License

MIT – free to use, modify, and deploy.
