/* ============================================================
   map.js – Leaflet map setup, NASA GIBS cloud layer, fallback
   ============================================================ */

const AppMap = (() => {
  let map = null;
  let cloudLayer = null;
  let satelliteLayer = null;
  let baseLayer = null;
  let currentMode = 'clouds';

  const OSM_TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // NASA GIBS cloud overlay (true colour MODIS Aqua)
  const NASA_CLOUDS_TILE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/{time}/{TileMatrixSet}/{z}/{y}/{x}.jpg';
  const NASA_ATTR = 'Imagery provided by <a href="https://earthdata.nasa.gov" target="_blank">NASA EOSDIS GIBS</a>';

  // NASA Cloud Fraction overlay
  const NASA_CLOUD_FRAC_TILE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Cloud_Effective_Radius/default/default/{TileMatrixSet}/{z}/{y}/{x}.png';

  /**
   * Initialise the map into #map-container
   */
  function init(lat, lon) {
    if (map) {
      map.setView([lat, lon], 9);
      return;
    }

    const container = document.getElementById('map-container');
    if (!container) return;

    map = L.map('map-container', {
      center: [lat, lon],
      zoom: 9,
      zoomControl: true,
      attributionControl: false,
    });

    // Base OSM layer
    baseLayer = L.tileLayer(OSM_TILE, {
      maxZoom: 19,
      attribution: OSM_ATTR,
    }).addTo(map);

    // Try NASA cloud layer, fallback to simple OSM
    addCloudLayer();

    // Custom attribution
    L.control.attribution({ prefix: false }).addTo(map);
    map.attributionControl.setPrefix('');
    updateAttribution(OSM_ATTR + ' | ' + NASA_ATTR);

    // User marker
    updateMarker(lat, lon);
  }

  function addCloudLayer() {
    if (cloudLayer) {
      map.removeLayer(cloudLayer);
      cloudLayer = null;
    }

    // NASA GIBS MODIS – use today's date
    const today = new Date().toISOString().slice(0, 10);
    const tileUrl = NASA_CLOUDS_TILE
      .replace('{time}', today)
      .replace('{TileMatrixSet}', 'GoogleMapsCompatible_Level9');

    cloudLayer = L.tileLayer(tileUrl, {
      opacity: 0.6,
      maxZoom: 9,
      attribution: NASA_ATTR,
      errorTileUrl: '', // silently fail
    });

    // Try to add, remove if errors
    let tileErrors = 0;
    cloudLayer.on('tileerror', () => {
      tileErrors++;
      if (tileErrors > 3 && map.hasLayer(cloudLayer)) {
        map.removeLayer(cloudLayer);
        console.warn('[Map] NASA GIBS unavailable, cloud layer removed');
      }
    });

    if (currentMode === 'clouds') {
      cloudLayer.addTo(map);
    }
  }

  function addSatelliteLayer() {
    if (satelliteLayer) {
      map.removeLayer(satelliteLayer);
    }

    // Esri World Imagery as satellite fallback
    satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri',
      }
    );

    if (currentMode === 'satellite') {
      satelliteLayer.addTo(map);
    }
  }

  function setMode(mode) {
    if (!map) return;
    currentMode = mode;

    // Remove both overlays
    if (cloudLayer && map.hasLayer(cloudLayer)) map.removeLayer(cloudLayer);
    if (satelliteLayer && map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
    if (baseLayer && map.hasLayer(baseLayer)) map.removeLayer(baseLayer);

    if (mode === 'clouds') {
      baseLayer.addTo(map);
      if (cloudLayer) cloudLayer.addTo(map);
    } else if (mode === 'satellite') {
      addSatelliteLayer();
      satelliteLayer.addTo(map);
    }

    document.getElementById('toggle-satellite')?.classList.toggle('active', mode === 'satellite');
    document.getElementById('toggle-clouds')?.classList.toggle('active', mode === 'clouds');
  }

  let userMarker = null;
  function updateMarker(lat, lon) {
    if (!map) return;

    const icon = L.divIcon({
      className: '',
      html: `<div style="
        width:18px;height:18px;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);
        border:3px solid white;
        border-radius:50%;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
      "></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    if (userMarker) {
      userMarker.setLatLng([lat, lon]);
    } else {
      userMarker = L.marker([lat, lon], { icon }).addTo(map);
    }
  }

  function panTo(lat, lon) {
    if (map) map.setView([lat, lon], 10, { animate: true });
    updateMarker(lat, lon);
  }

  function updateAttribution(text) {
    const el = document.getElementById('map-attribution');
    if (el) el.innerHTML = text;
  }

  function invalidate() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  }

  return { init, panTo, setMode, invalidate, updateMarker };
})();

window.AppMap = AppMap;
