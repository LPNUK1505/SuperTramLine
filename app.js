// Initialise map centred on Sheffield
const MAP_BOUNDS_CENTRE = [53.3780, -1.4658]; // Fitzalan Square / Ponds Forge
const MAP_BOUNDS_KM_NS = 15; // north-south radius
const MAP_BOUNDS_KM_EW = 25; // east-west radius — wider to allow panning to Hathersage/Todwick
const _bLat = MAP_BOUNDS_KM_NS / 111;
const _bLng = MAP_BOUNDS_KM_EW / (111 * Math.cos(MAP_BOUNDS_CENTRE[0] * Math.PI / 180));
const MAP_MAX_BOUNDS = [
  [MAP_BOUNDS_CENTRE[0] - _bLat, MAP_BOUNDS_CENTRE[1] - _bLng],
  [MAP_BOUNDS_CENTRE[0] + _bLat, MAP_BOUNDS_CENTRE[1] + _bLng],
];

const map = L.map('map', { zoomControl: false, maxBoundsViscosity: 1.0, minZoom: 11 }).setView([53.38, -1.47], 13);
map.setMaxBounds(MAP_MAX_BOUNDS);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// Route config
const routes = [
  { file: 'routes/blue.geojson',      colour: '#0057E7', name: 'Blue',       ref: 'BLUE' },
  { file: 'routes/yellow.geojson',     colour: '#FFB800', name: 'Yellow',     ref: 'YELL' },
  { file: 'routes/purple.geojson',     colour: '#9500D3', name: 'Purple',     ref: 'PURP' },
  { file: 'routes/tram-train.geojson', colour: '#3D3D3D', name: 'Tram Train', ref: 'TT'   },
];

// Panes ensure all halos render beneath all route lines, regardless of async load order
map.createPane('haloPane').style.zIndex  = 300;
map.createPane('routePane').style.zIndex = 301;

// Load and store each route layer
const routeLayers = {};
const routeHaloLayers = {};
const routeGeojsons = {};
const stopLayers = {};
let activeRoute = null;

// Travel-info state
let userLatLng = null;
let selectedStop = null;
let lockedRoute = null;     // route name once user has clearly diverged onto one line
let prevSnapIndex = null;   // previous segment index on the route, for direction detection
let travelDirection = 0;    // 1 = forward along route coords, -1 = backward, 0 = unknown
const routeStopIndexCache = {}; // routeName → [{name, snapIndex}] sorted — built lazily
const PESSIMISTIC_KMH = 18; // km/h — ~14% above timetabled speed of ~20.6 km/h
const NOT_ON_ROUTE_KM = 0.15;  // 150 m from line → "not on route"
const LOCK_THRESHOLD_KM = 0.04; // 40 m gap between nearest and 2nd-nearest → lock

const showAll = () => {
  routes.forEach(r => {
    routeHaloLayers[r.name]?.addTo(map);
    routeLayers[r.name]?.addTo(map);
    stopLayers[r.name]?.addTo(map);
  });
};
const hideAll = () => {
  routes.forEach(r => {
    routeHaloLayers[r.name]?.remove();
    routeLayers[r.name]?.remove();
    stopLayers[r.name]?.remove();
  });
};

routes.forEach(route => {
  fetch(route.file)
    .then(r => r.json())
    .then(geojson => {
      routeGeojsons[route.name] = geojson;
      routeHaloLayers[route.name] = L.geoJSON(geojson, {
        style: { color: '#ffffff', weight: 12, opacity: 0.9, pane: 'haloPane', lineCap: 'round', lineJoin: 'round' }
      }).addTo(map);
      routeLayers[route.name] = L.geoJSON(geojson, {
        style: { color: route.colour, weight: 7, opacity: 1, pane: 'routePane', lineCap: 'round', lineJoin: 'round' }
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
      routeHaloLayers[name]?.addTo(map);
      routeLayers[name]?.addTo(map);
      stopLayers[name]?.addTo(map);
    }
    lockedRoute = null;
    prevSnapIndex = null;
    travelDirection = 0;
    updateTravelInfo();
  });
});

// Unnamed stop marker layer — used for the initial fast render from stops.geojson.
// Replaced by buildNamedStopLayer once Overpass names are available.
const makeStopLayer = (features, routeColour) => L.geoJSON({ type: 'FeatureCollection', features }, {
  pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
    radius: 6,
    fillColor: '#ffffff',
    color: routeColour,
    weight: 3,
    fillOpacity: 1
  })
});

// Named stop layer — built from allStops so tooltips show the real stop name.
// Tooltip shows on hover (desktop) and tap (mobile).
const buildNamedStopLayer = (stopsOnRoute, routeColour) => {
  const group = L.layerGroup();
  stopsOnRoute.forEach(stop => {
    const marker = L.circleMarker(stop.latlng, {
      radius: 6,
      fillColor: '#ffffff',
      color: routeColour,
      weight: 3,
      fillOpacity: 1
    });
    marker.bindTooltip(stop.name, { direction: 'auto', sticky: false });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      marker.isTooltipOpen() ? marker.closeTooltip() : marker.openTooltip();
    });
    group.addLayer(marker);
  });
  return group;
};

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
      stopLayers[route.name] = makeStopLayer(buckets[route.name], route.colour).addTo(map);
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
    const CACHE_KEY = 'supertram_stops_v2';
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

      // Replace the unnamed initial stop layers with properly named interactive ones
      routes.forEach(route => {
        stopLayers[route.name]?.remove();
        const stopsOnRoute = allStops.filter(s => s.routes.some(r => r.name === route.name));
        stopLayers[route.name] = buildNamedStopLayer(stopsOnRoute, route.colour);
        if (activeRoute === null || activeRoute === route.name) {
          stopLayers[route.name].addTo(map);
        }
      });
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
      body: '[out:json];node["railway"="tram_stop"](53.28,-1.62,53.52,-1.32);out body;'
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
      prevSnapIndex = null;
      travelDirection = 0;
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
  updateRecenterBtn();
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

// --- Re-centre button ---
const recenterBtn = document.getElementById('recenter-btn');

function updateRecenterBtn() {
  if (!userLatLng) { recenterBtn.style.display = 'none'; return; }
  const d = map.distance(map.getCenter(), L.latLng(userLatLng[0], userLatLng[1]));
  recenterBtn.style.display = d > 150 ? 'flex' : 'none';
}

map.on('moveend', updateRecenterBtn);

recenterBtn.addEventListener('click', () => {
  map.setView(userLatLng, Math.max(map.getZoom(), 15));
});

// --- Next stop detection ---
// Builds a sorted list of {name, snapIndex} for stops on a given route.
// Computed once per route and cached — allStops must be populated first.
function getStopIndexOnRoute(routeName, lineFeature) {
  if (routeStopIndexCache[routeName]) return routeStopIndexCache[routeName];
  if (!allStops.length) return null;

  const result = allStops
    .filter(s => s.routes.some(r => r.name === routeName))
    .map(stop => {
      const pt = turf.point([stop.latlng[1], stop.latlng[0]]);
      const snapped = turf.nearestPointOnLine(lineFeature, pt);
      return { name: stop.name, snapIndex: snapped.properties.index };
    })
    .sort((a, b) => a.snapIndex - b.snapIndex);

  if (result.length) routeStopIndexCache[routeName] = result;
  return result.length ? result : null;
}

// --- Travel distance / time along route ---
function updateTravelInfo() {
  const el = document.getElementById('travel-info');

  if (!userLatLng) { el.style.display = 'none'; return; }

  // Candidate routes: use destination's routes if selected, otherwise all routes
  const candidateRoutes = selectedStop
    ? (activeRoute ? selectedStop.routes.filter(r => r.name === activeRoute) : selectedStop.routes)
    : (activeRoute ? routes.filter(r => r.name === activeRoute) : routes);

  // Snap user to every candidate line and sort by distance
  const userPt = turf.point([userLatLng[1], userLatLng[0]]);
  const snaps = candidateRoutes
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
    lockedRoute = null;
    chosen = snaps[0];
    if (snaps.length > 1 && (snaps[1].dist - snaps[0].dist) > LOCK_THRESHOLD_KM) {
      lockedRoute = chosen.route.name;
    }
  }

  // Direction tracking: compare current segment index to previous
  const currentIndex = chosen.snapped.properties.index;
  if (prevSnapIndex !== null && currentIndex !== prevSnapIndex) {
    travelDirection = currentIndex > prevSnapIndex ? 1 : -1;
  }
  prevSnapIndex = currentIndex;

  // Find next stop in direction of travel
  let nextStopName = null;
  if (travelDirection !== 0) {
    const stopIndices = getStopIndexOnRoute(chosen.route.name, chosen.lineFeature);
    if (stopIndices) {
      if (travelDirection === 1) {
        nextStopName = stopIndices.find(s => s.snapIndex > currentIndex)?.name ?? null;
      } else {
        nextStopName = [...stopIndices].reverse().find(s => s.snapIndex < currentIndex)?.name ?? null;
      }
    }
  }

  // Nothing useful to show if off-route and no destination was set
  if (chosen.dist > NOT_ON_ROUTE_KM && !selectedStop && !nextStopName) {
    el.style.display = 'none';
    return;
  }

  el.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'route-dot';
  dot.style.background = chosen.route.colour;
  el.appendChild(dot);

  const parts = [];
  if (chosen.dist > NOT_ON_ROUTE_KM) {
    parts.push('Not on route');
  } else if (selectedStop) {
    const destPt = turf.point([selectedStop.latlng[1], selectedStop.latlng[0]]);
    const snappedDest = turf.nearestPointOnLine(chosen.lineFeature, destPt);
    const segment = turf.lineSlice(chosen.snapped, snappedDest, chosen.lineFeature);
    const distKm = turf.length(segment, { units: 'kilometers' });
    const timeMin = Math.ceil((distKm / PESSIMISTIC_KMH) * 60);
    parts.push(`${distKm.toFixed(1)} km · ~${timeMin} min`);
  }
  if (nextStopName) parts.push(`→ ${nextStopName}`);

  if (!parts.length) { el.style.display = 'none'; return; }

  const text = document.createElement('span');
  text.textContent = parts.join(' · ');
  el.appendChild(text);
  el.style.display = 'flex';
}
