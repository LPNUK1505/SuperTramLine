// Initialise map centred on Sheffield
const map = L.map('map').setView([53.38, -1.47], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// Route config — colours match the official Supertram line colours
const routes = [
  { file: 'routes/blue.geojson',      colour: '#0074D9', name: 'Blue',       ref: 'BLUE' },
  { file: 'routes/yellow.geojson',     colour: '#FFD700', name: 'Yellow',     ref: 'YELL' },
  { file: 'routes/purple.geojson',     colour: '#8B008B', name: 'Purple',     ref: 'PURP' },
  { file: 'routes/tram-train.geojson', colour: '#333333', name: 'Tram Train', ref: 'TT'   },
];

// Load and store each route layer
const routeLayers = {};
const routeGeojsons = {};
const stopLayers = {};
let activeRoute = null;

// Travel-info state
let userLatLng = null;
let selectedStop = null;
let lockedRoute = null; // route name once user has clearly diverged onto one line
const PESSIMISTIC_KMH = 15; // km/h — tune this to adjust time estimates
const NOT_ON_ROUTE_KM = 0.15;  // 150 m from line → "not on route"
const LOCK_THRESHOLD_KM = 0.04; // 40 m gap between nearest and 2nd-nearest → lock

const showAll = () => {
  routes.forEach(r => {
    routeLayers[r.name]?.addTo(map);
    stopLayers[r.name]?.addTo(map);
  });
};
const hideAll = () => {
  routes.forEach(r => {
    routeLayers[r.name]?.remove();
    stopLayers[r.name]?.remove();
  });
};

routes.forEach(route => {
  fetch(route.file)
    .then(r => r.json())
    .then(geojson => {
      routeGeojsons[route.name] = geojson;
      routeLayers[route.name] = L.geoJSON(geojson, {
        style: { color: route.colour, weight: 4, opacity: 0.8 }
      }).addTo(map);
    })
    .catch(err => console.error(`Failed to load ${route.name}:`, err));
});

// Button toggle logic
document.querySelectorAll('#buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.route;
    if (activeRoute === name) {
      btn.classList.remove('active');
      activeRoute = null;
      showAll();
    } else {
      document.querySelectorAll('#buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRoute = name;
      hideAll();
      routeLayers[name]?.addTo(map);
      stopLayers[name]?.addTo(map);
    }
    lockedRoute = null;
    updateTravelInfo();
  });
});

// Stop marker helper
const makeStopLayer = (features) => L.geoJSON({ type: 'FeatureCollection', features }, {
  pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
    radius: 4,
    fillColor: '#fff',
    color: '#333',
    weight: 1.5,
    fillOpacity: 1
  }),
  onEachFeature: (feature, layer) => {
    const name = feature.properties.name
      || feature.properties['@relations']?.[0]?.reltags?.name
      || 'Tram Stop';
    layer.bindTooltip(name, { direction: 'top', offset: [0, -6] });
  }
});

// Load stops and split into per-route layers
fetch('routes/stops.geojson')
  .then(r => r.json())
  .then(geojson => {
    const refToRoute = Object.fromEntries(routes.map(r => [r.ref, r]));
    const refToName  = Object.fromEntries(routes.map(r => [r.ref, r.name]));
    const buckets    = Object.fromEntries(routes.map(r => [r.name, []]));

    geojson.features.forEach(feature => {
      const refs = (feature.properties['@relations'] || []).map(rel => rel.reltags?.ref);
      const added = new Set();
      refs.forEach(ref => {
        const routeName = refToName[ref];
        if (routeName && !added.has(routeName)) {
          buckets[routeName].push(feature);
          added.add(routeName);
        }
      });
    });

    routes.forEach(route => {
      stopLayers[route.name] = makeStopLayer(buckets[route.name]).addTo(map);
    });

    // Build coordinate→route map for proximity matching below.
    // stops.geojson has route info but no names; railway=tram_stop nodes have
    // names but different node IDs. We match them by nearest coordinate.
    const coordRouteMap = geojson.features.map(feature => {
      const seenRefs = new Set();
      const stopRoutes = (feature.properties['@relations'] || [])
        .map(rel => rel.reltags?.ref)
        .filter(ref => ref && !seenRefs.has(ref) && seenRefs.add(ref))
        .map(ref => refToRoute[ref])
        .filter(Boolean);
      return { lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1], routes: stopRoutes };
    });

    // Fetch named tram_stop nodes — cached in localStorage to avoid Overpass rate limits.
    const CACHE_KEY = 'supertram_stops_v1';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    const populateStops = (elements) => {
      const seen = new Set();
      elements.forEach(el => {
        const name = el.tags?.name;
        if (!name || seen.has(name)) return;
        seen.add(name);

        let bestDist = Infinity, bestRoutes = [];
        coordRouteMap.forEach(entry => {
          const dLat = entry.lat - el.lat;
          const dLng = (entry.lng - el.lon) * 0.6; // cos(53°) correction
          const dist = dLat * dLat + dLng * dLng;
          if (dist < bestDist) { bestDist = dist; bestRoutes = entry.routes; }
        });

        allStops.push({ name, latlng: [el.lat, el.lon], routes: bestRoutes });
      });
      allStops.sort((a, b) => a.name.localeCompare(b.name));
    };

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { ts, elements } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          populateStops(elements);
          return;
        }
      }
    } catch (_) { /* ignore malformed cache */ }

    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: '[out:json];node["railway"="tram_stop"](53.30,-1.60,53.50,-1.35);out body;'
    })
      .then(r => r.json())
      .then(data => {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), elements: data.elements }));
        } catch (_) { /* storage full or unavailable */ }
        populateStops(data.elements);
      })
      .catch(err => console.error('Failed to fetch stop names:', err));
  })
  .catch(err => console.error('Failed to load stops:', err));

// --- Stop search ---
const allStops = [];

const highlightMarker = L.circleMarker([0, 0], {
  radius: 12,
  fillColor: '#FFD700',
  color: '#222',
  weight: 2.5,
  fillOpacity: 0.95
});

const searchInput = document.getElementById('stop-search');
const searchResults = document.getElementById('search-results');

const hideResults = () => { searchResults.style.display = 'none'; };
const showResults = () => { searchResults.style.display = 'block'; };
hideResults();

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = '';
  if (q.length < 1) { hideResults(); selectedStop = null; updateTravelInfo(); return; }

  const pool = activeRoute
    ? allStops.filter(s => (s.routes || []).some(r => r.name === activeRoute))
    : allStops;

  const matches = pool.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) { hideResults(); return; }

  matches.forEach(stop => {
    const li = document.createElement('li');

    const dots = document.createElement('span');
    dots.className = 'stop-route-dots';
    (stop.routes || []).forEach(r => {
      const dot = document.createElement('span');
      dot.className = 'route-dot';
      dot.style.background = r.colour;
      dot.title = r.name;
      dots.appendChild(dot);
    });

    const label = document.createElement('span');
    label.textContent = stop.name;

    li.appendChild(dots);
    li.appendChild(label);
    li.addEventListener('click', () => {
      map.setView(stop.latlng, 17);
      highlightMarker.setLatLng(stop.latlng).addTo(map);
      searchInput.value = stop.name;
      hideResults();
      selectedStop = stop;
      lockedRoute = null;
      updateTravelInfo();
      // Close sidebar on mobile after selecting a stop
      document.getElementById('top-bar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('visible');
    });
    searchResults.appendChild(li);
  });
  showResults();
});

document.addEventListener('click', e => {
  if (!e.target.closest('#search-container')) hideResults();
});

// --- GPS Tracking ---
const userMarker = L.circleMarker([0, 0], {
  radius: 10,
  fillColor: '#e74c3c',
  color: '#fff',
  weight: 3,
  fillOpacity: 1
});

const accuracyCircle = L.circle([0, 0], {
  radius: 1,
  color: '#e74c3c',
  fillColor: '#e74c3c',
  fillOpacity: 0.1,
  weight: 1
});

let firstFix = true;

function onPositionUpdate(pos) {
  const latlng = [pos.coords.latitude, pos.coords.longitude];
  userLatLng = latlng;
  userMarker.setLatLng(latlng).addTo(map);
  accuracyCircle.setLatLng(latlng).setRadius(pos.coords.accuracy).addTo(map);
  if (firstFix) {
    map.setView(latlng, 15);
    firstFix = false;
  }
  updateTravelInfo();
}

function showGpsError(message) {
  const el = document.getElementById('gps-error');
  el.textContent = message;
  el.style.display = 'block';
}

function onPositionError(err) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const denied = isIOS
    ? 'Location denied. To fix: Settings → Privacy → Location Services → Safari → While Using'
    : 'Location denied. Allow access in your browser site settings.';
  const messages = {
    1: denied,
    2: 'GPS position unavailable.',
    3: 'GPS timed out — try again outdoors.',
  };
  document.getElementById('locate-btn').style.display = 'block';
  showGpsError(messages[err.code] || `GPS error: ${err.message}`);
}

document.getElementById('locate-btn').addEventListener('click', () => {
  if (!window.isSecureContext) {
    showGpsError('GPS requires HTTPS. Location unavailable.');
  } else if ('geolocation' in navigator) {
    document.getElementById('locate-btn').style.display = 'none';
    navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    });
  } else {
    showGpsError('Geolocation not supported on this device.');
  }
});

// --- Mobile sidebar ---
const menuBtn = document.getElementById('menu-btn');
const topBar  = document.getElementById('top-bar');
const backdrop = document.getElementById('sidebar-backdrop');

menuBtn.addEventListener('click', () => {
  topBar.classList.toggle('open');
  backdrop.classList.toggle('visible');
});
backdrop.addEventListener('click', () => {
  topBar.classList.remove('open');
  backdrop.classList.remove('visible');
});

// --- Travel distance / time along route ---
function updateTravelInfo() {
  const el = document.getElementById('travel-info');

  if (!userLatLng || !selectedStop) {
    el.style.display = 'none';
    return;
  }

  // If the user manually selected a route, restrict to that; otherwise all routes for this stop
  const candidates = activeRoute
    ? selectedStop.routes.filter(r => r.name === activeRoute)
    : selectedStop.routes;

  // Snap user to every candidate line and sort by distance
  const userPt = turf.point([userLatLng[1], userLatLng[0]]);
  const snaps = candidates
    .map(route => {
      const geojson = routeGeojsons[route.name];
      if (!geojson) return null;
      const f = geojson.features.find(f => f.geometry.type === 'LineString');
      if (!f) return null;
      const snapped = turf.nearestPointOnLine(f, userPt, { units: 'kilometers' });
      return { route, lineFeature: f, snapped, dist: snapped.properties.dist };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist);

  if (!snaps.length) { el.style.display = 'none'; return; }

  // Route selection: honour existing lock, or pick nearest and lock if clearly diverged
  let chosen = lockedRoute ? snaps.find(s => s.route.name === lockedRoute) : null;
  if (!chosen) {
    // Lock is absent or the locked route is no longer a candidate — pick nearest
    lockedRoute = null;
    chosen = snaps[0];
    // Only lock once the gap to the next line is meaningful (avoids locking in city centre)
    if (snaps.length > 1 && (snaps[1].dist - snaps[0].dist) > LOCK_THRESHOLD_KM) {
      lockedRoute = chosen.route.name;
    }
  }

  el.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'route-dot';
  dot.style.background = chosen.route.colour;
  el.appendChild(dot);

  const text = document.createElement('span');
  if (chosen.dist > NOT_ON_ROUTE_KM) {
    text.textContent = 'Not on route';
  } else {
    const destPt = turf.point([selectedStop.latlng[1], selectedStop.latlng[0]]);
    const snappedDest = turf.nearestPointOnLine(chosen.lineFeature, destPt);
    const segment = turf.lineSlice(chosen.snapped, snappedDest, chosen.lineFeature);
    const distKm = turf.length(segment, { units: 'kilometers' });
    const timeMin = Math.ceil((distKm / PESSIMISTIC_KMH) * 60);
    text.textContent = `${distKm.toFixed(1)} km until destination · ~${timeMin} min`;
  }

  el.appendChild(text);
  el.style.display = 'flex';
}
