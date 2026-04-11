/* ============================================================
   weather.js – API logic with fallback chain
   Open-Meteo → MET Norway → OpenWeatherMap → Cache
   ============================================================ */

const WeatherAPI = (() => {

  const CACHE_KEY = 'stepout_weather_cache';
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Safari < 16 doesn't support AbortSignal.timeout — use manual controller
  function fetchWithTimeout(url, options = {}, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    // Use window.fetch explicitly to avoid shadowing by local `fetch` function names
    return window.fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  // --- Open-Meteo WMO weather code to emoji/description ---
  const WMO_MAP = {
    0:  { emoji: '☀️',  desc: 'Clear sky' },
    1:  { emoji: '🌤️',  desc: 'Mainly clear' },
    2:  { emoji: '⛅',  desc: 'Partly cloudy' },
    3:  { emoji: '☁️',  desc: 'Overcast' },
    45: { emoji: '🌫️',  desc: 'Foggy' },
    48: { emoji: '🌫️',  desc: 'Icy fog' },
    51: { emoji: '🌦️',  desc: 'Light drizzle' },
    53: { emoji: '🌦️',  desc: 'Moderate drizzle' },
    55: { emoji: '🌧️',  desc: 'Dense drizzle' },
    56: { emoji: '🌧️',  desc: 'Light freezing drizzle' },
    57: { emoji: '🌧️',  desc: 'Heavy freezing drizzle' },
    61: { emoji: '🌧️',  desc: 'Slight rain' },
    63: { emoji: '🌧️',  desc: 'Moderate rain' },
    65: { emoji: '🌧️',  desc: 'Heavy rain' },
    66: { emoji: '🌧️',  desc: 'Light freezing rain' },
    67: { emoji: '🌧️',  desc: 'Heavy freezing rain' },
    71: { emoji: '🌨️',  desc: 'Slight snow' },
    73: { emoji: '🌨️',  desc: 'Moderate snow' },
    75: { emoji: '❄️',  desc: 'Heavy snow' },
    77: { emoji: '🌨️',  desc: 'Snow grains' },
    80: { emoji: '🌦️',  desc: 'Slight showers' },
    81: { emoji: '🌧️',  desc: 'Moderate showers' },
    82: { emoji: '⛈️',  desc: 'Violent showers' },
    85: { emoji: '🌨️',  desc: 'Slight snow showers' },
    86: { emoji: '❄️',  desc: 'Heavy snow showers' },
    87: { emoji: '🌨️',  desc: 'Light hail showers' },
    88: { emoji: '🌨️',  desc: 'Heavy hail showers' },
    89: { emoji: '🌨️',  desc: 'Light hail' },
    90: { emoji: '⛈️',  desc: 'Heavy hail' },
    95: { emoji: '⛈️',  desc: 'Thunderstorm' },
    96: { emoji: '⛈️',  desc: 'Thunderstorm with hail' },
    99: { emoji: '⛈️',  desc: 'Heavy thunderstorm' },
  };

  function getWMO(code) {
    return WMO_MAP[code] || { emoji: '🌡️', desc: 'Unknown' };
  }

  // --- Unified weather data format ---
  function createResult(source, current, hourly, minutely15) {
    return { source, current, hourly, minutely15, fetchedAt: Date.now() };
  }

  // =========================================================
  // 1. Open-Meteo (primary, no API key needed)
  // =========================================================
  async function fetchOpenMeteo(lat, lon) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('current', [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'precipitation', 'weather_code', 'cloud_cover',
      'wind_speed_10m', 'wind_direction_10m', 'uv_index'
    ].join(','));
    url.searchParams.set('hourly', [
      'temperature_2m', 'precipitation_probability', 'precipitation',
      'weather_code', 'cloud_cover', 'wind_speed_10m', 'uv_index'
    ].join(','));
    url.searchParams.set('minutely_15', [
      'precipitation', 'weather_code', 'wind_speed_10m', 'cloud_cover'
    ].join(','));
    url.searchParams.set('forecast_days', '2');
    url.searchParams.set('timezone', 'auto');

    const res = await fetchWithTimeout(url.toString(), {}, 8000);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();

    // Normalise current conditions
    const c = data.current;
    const wmo = getWMO(c.weather_code);
    const current = {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      precipitation: c.precipitation,
      weatherCode: c.weather_code,
      emoji: wmo.emoji,
      description: wmo.desc,
      cloudCover: c.cloud_cover,
      windSpeed: Math.round(c.wind_speed_10m),
      windDir: c.wind_direction_10m,
      uvIndex: c.uv_index,
      units: data.current_units,
    };

    // Hourly (next 24 h)
    const now = Date.now();
    const hourly = [];
    for (let i = 0; i < data.hourly.time.length; i++) {
      const t = new Date(data.hourly.time[i]).getTime();
      if (t < now - 3600000) continue;
      if (hourly.length >= 24) break;
      const hw = getWMO(data.hourly.weather_code[i]);
      hourly.push({
        time: data.hourly.time[i],
        temp: Math.round(data.hourly.temperature_2m[i]),
        precipProb: data.hourly.precipitation_probability[i] ?? 0,
        precip: data.hourly.precipitation[i] ?? 0,
        weatherCode: data.hourly.weather_code[i],
        emoji: hw.emoji,
        cloudCover: data.hourly.cloud_cover[i] ?? 0,
        windSpeed: Math.round(data.hourly.wind_speed_10m[i] ?? 0),
        uvIndex: data.hourly.uv_index[i] ?? 0,
      });
    }

    // 15-minute intervals (next 3 h = 12 intervals)
    const minutely15 = [];
    for (let i = 0; i < data.minutely_15.time.length; i++) {
      const t = new Date(data.minutely_15.time[i]).getTime();
      if (t < now - 900000) continue;
      if (minutely15.length >= 12) break;
      minutely15.push({
        time: data.minutely_15.time[i],
        precip: data.minutely_15.precipitation[i] ?? 0,
        weatherCode: data.minutely_15.weather_code[i],
        windSpeed: Math.round(data.minutely_15.wind_speed_10m[i] ?? 0),
        cloudCover: data.minutely_15.cloud_cover[i] ?? 0,
      });
    }

    return createResult('Open-Meteo', current, hourly, minutely15);
  }

  // =========================================================
  // 2. MET Norway fallback
  // =========================================================
  async function fetchMETNorway(lat, lon) {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'StepOut/1.0 (example@example.com)' },
    }, 8000);
    if (!res.ok) throw new Error(`MET Norway HTTP ${res.status}`);
    const data = await res.json();

    const series = data.properties.timeseries;
    if (!series || series.length === 0) throw new Error('MET Norway: empty timeseries');

    const now = new Date();
    const closest = series.find(s => new Date(s.time) >= now) || series[0];
    const cd = closest.data.instant.details;

    // WMO approximation from MET symbol codes
    const symbolCode = closest.data.next_1_hours?.summary?.symbol_code || '';
    const emoji = symbolToEmoji(symbolCode);

    const current = {
      temp: Math.round(cd.air_temperature ?? 0),
      feelsLike: Math.round(cd.air_temperature ?? 0), // MET doesn't provide feels_like directly
      humidity: Math.round(cd.relative_humidity ?? 0),
      precipitation: closest.data.next_1_hours?.details?.precipitation_amount ?? 0,
      weatherCode: null,
      emoji,
      description: symbolCode.replace(/_/g, ' ') || 'Unknown',
      cloudCover: Math.round(cd.cloud_area_fraction ?? 0),
      windSpeed: Math.round(cd.wind_speed ?? 0),
      windDir: cd.wind_from_direction ?? 0,
      uvIndex: cd.ultraviolet_index_clear_sky ?? 0,
      units: { temperature: '°C', wind_speed: 'km/h' },
    };

    // Build hourly from MET
    const hourly = [];
    const startIdx = series.findIndex(s => new Date(s.time) >= now);
    for (let i = Math.max(0, startIdx); i < series.length && hourly.length < 24; i++) {
      const s = series[i];
      const d = s.data.instant.details;
      const sc = s.data.next_1_hours?.summary?.symbol_code || '';
      const precip = s.data.next_1_hours?.details?.precipitation_amount ?? 0;
      hourly.push({
        time: s.time,
        temp: Math.round(d.air_temperature ?? 0),
        precipProb: 0,
        precip,
        weatherCode: null,
        emoji: symbolToEmoji(sc),
        cloudCover: Math.round(d.cloud_area_fraction ?? 0),
        windSpeed: Math.round(d.wind_speed ?? 0),
        uvIndex: d.ultraviolet_index_clear_sky ?? 0,
      });
    }

    // No 15-minute data from MET – approximate from hourly
    const minutely15 = [];
    for (let i = 0; i < Math.min(hourly.length, 3); i++) {
      for (let q = 0; q < 4; q++) {
        minutely15.push({
          time: new Date(new Date(hourly[i].time).getTime() + q * 15 * 60000).toISOString(),
          precip: hourly[i].precip / 4,
          weatherCode: null,
          windSpeed: hourly[i].windSpeed,
          cloudCover: hourly[i].cloudCover,
        });
      }
    }

    return createResult('MET Norway', current, hourly, minutely15);
  }

  function symbolToEmoji(code) {
    if (!code) return '🌡️';
    if (code.includes('thunder')) return '⛈️';
    if (code.includes('snow')) return '❄️';
    if (code.includes('sleet')) return '🌨️';
    if (code.includes('heavyrain') || code.includes('rain')) return '🌧️';
    if (code.includes('lightrain') || code.includes('drizzle')) return '🌦️';
    if (code.includes('fog')) return '🌫️';
    if (code.includes('cloudy') && !code.includes('partly')) return '☁️';
    if (code.includes('partlycloudy') || code.includes('fair')) return '⛅';
    if (code.includes('clearsky') || code === 'fair_day') return '☀️';
    return '🌤️';
  }

  // =========================================================
  // 3. OpenWeatherMap fallback (free tier, key optional)
  // =========================================================
  async function fetchOpenWeatherMap(lat, lon) {
    const apiKey = window.STEPOUT_OWM_KEY || '';
    if (!apiKey) throw new Error('OWM: no API key configured');

    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&cnt=40`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error(`OWM HTTP ${res.status}`);
    const data = await res.json();

    const now = new Date();
    const first = data.list[0];
    const current = {
      temp: Math.round(first.main.temp),
      feelsLike: Math.round(first.main.feels_like),
      humidity: first.main.humidity,
      precipitation: first.rain?.['3h'] ? first.rain['3h'] / 3 : 0,
      weatherCode: first.weather[0].id,
      emoji: owmIdToEmoji(first.weather[0].id),
      description: first.weather[0].description,
      cloudCover: first.clouds.all,
      windSpeed: Math.round((first.wind.speed || 0) * 3.6),
      windDir: first.wind.deg || 0,
      uvIndex: 0,
      units: { temperature: '°C', wind_speed: 'km/h' },
    };

    const hourly = data.list
      .filter(item => new Date(item.dt_txt) >= now)
      .slice(0, 24)
      .map(item => ({
        time: item.dt_txt,
        temp: Math.round(item.main.temp),
        precipProb: Math.round((item.pop || 0) * 100),
        precip: item.rain?.['3h'] ? item.rain['3h'] / 3 : 0,
        weatherCode: item.weather[0].id,
        emoji: owmIdToEmoji(item.weather[0].id),
        cloudCover: item.clouds.all,
        windSpeed: Math.round((item.wind.speed || 0) * 3.6),
        uvIndex: 0,
      }));

    const minutely15 = [];
    for (let i = 0; i < Math.min(hourly.length, 3); i++) {
      for (let q = 0; q < 4; q++) {
        minutely15.push({
          time: new Date(new Date(hourly[i].time).getTime() + q * 15 * 60000).toISOString(),
          precip: hourly[i].precip / 4,
          weatherCode: hourly[i].weatherCode,
          windSpeed: hourly[i].windSpeed,
          cloudCover: hourly[i].cloudCover,
        });
      }
    }

    return createResult('OpenWeatherMap', current, hourly, minutely15);
  }

  function owmIdToEmoji(id) {
    if (id >= 200 && id < 300) return '⛈️';
    if (id >= 300 && id < 400) return '🌦️';
    if (id >= 500 && id < 600) return id >= 511 ? '🌨️' : '🌧️';
    if (id >= 600 && id < 700) return '❄️';
    if (id >= 700 && id < 800) return '🌫️';
    if (id === 800) return '☀️';
    if (id === 801) return '🌤️';
    if (id === 802) return '⛅';
    if (id >= 803) return '☁️';
    return '🌡️';
  }

  // =========================================================
  // Cache helpers
  // =========================================================
  function saveToCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* storage full, ignore */ }
  }

  function loadFromCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt > CACHE_TTL * 4) return null; // 2h max
      return cached;
    } catch (e) {
      return null;
    }
  }

  // =========================================================
  // Public: fetch with fallback chain
  // =========================================================
  async function fetchWeather(lat, lon) {
    const sources = [
      { name: 'Open-Meteo', fn: () => fetchOpenMeteo(lat, lon) },
      { name: 'MET Norway', fn: () => fetchMETNorway(lat, lon) },
      { name: 'OpenWeatherMap', fn: () => fetchOpenWeatherMap(lat, lon) },
    ];

    for (const src of sources) {
      try {
        if (window.DBG) window.DBG.info('Trying ' + src.name + '...');
        console.log(`[Weather] Trying ${src.name}...`);
        const result = await src.fn();
        saveToCache(result);
        if (window.DBG) window.DBG.ok(src.name + ' OK');
        console.log(`[Weather] Success: ${src.name}`);
        return result;
      } catch (err) {
        console.warn(`[Weather] ${src.name} failed:`, err.message);
        if (window.DBG) window.DBG.err(src.name + ' failed: ' + err.message);
      }
    }

    // All failed – try cache
    const cached = loadFromCache();
    if (cached) {
      console.log('[Weather] Using cached data');
      if (window.DBG) window.DBG.info('Using cached weather');
      return { ...cached, fromCache: true };
    }

    // Nothing works
    throw new Error('All weather sources unavailable');
  }

  function getCached() {
    return loadFromCache();
  }

  return { fetch: fetchWeather, getCached, getWMO };
})();

window.WeatherAPI = WeatherAPI;
