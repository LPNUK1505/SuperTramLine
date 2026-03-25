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
const stopLayers = {};
let activeRoute = null;

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
    const refToName = Object.fromEntries(routes.map(r => [r.ref, r.name]));
    const buckets = Object.fromEntries(routes.map(r => [r.name, []]));

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
  })
  .catch(err => console.error('Failed to load stops:', err));

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
  userMarker.setLatLng(latlng).addTo(map);
  accuracyCircle.setLatLng(latlng).setRadius(pos.coords.accuracy).addTo(map);
  if (firstFix) {
    map.setView(latlng, 15);
    firstFix = false;
  }
}

function showGpsError(message) {
  const el = document.getElementById('gps-error');
  el.textContent = message;
  el.style.display = 'block';
}

function onPositionError(err) {
  const messages = {
    1: 'GPS permission denied. Please allow location access.',
    2: 'GPS position unavailable.',
    3: 'GPS timed out.',
  };
  showGpsError(messages[err.code] || `GPS error: ${err.message}`);
}

if (!window.isSecureContext) {
  showGpsError('GPS requires HTTPS. Location unavailable.');
} else if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(onPositionUpdate, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 10000
  });
} else {
  showGpsError('Geolocation not supported on this device.');
}
