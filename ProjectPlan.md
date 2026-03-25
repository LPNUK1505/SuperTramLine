# SuperTramLine — Project Plan

## What You're Building

A mobile-friendly web app that shows your live GPS position on a Sheffield Supertram route and tells you how far along the line you are.

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Map | **Leaflet.js** + **OpenStreetMap tiles** | Free, lightweight, well-documented |
| Route data | **Overpass API** (or static GeoJSON export from OSM) | Supertram routes are already mapped in OpenStreetMap |
| GPS tracking | **Browser Geolocation API** (`navigator.geolocation.watchPosition`) | Built-in, no library needed |
| Distance calculation | **Turf.js** (`nearestPointOnLine`, `length`, `lineSlice`) | Snaps your position to the route and calculates progress |
| Framework | **Vanilla JS** or **React** (with `react-leaflet`) | Your preference — vanilla is simpler for this |
| Hosting | **Netlify** or **GitHub Pages** | Free, auto-deploys from Git, no backend needed |

---

## Project Structure

```
supertram-tracker/
├── index.html
├── style.css
├── app.js              # Main app logic
├── routes/
│   ├── blue.geojson    # Blue line route geometry
│   ├── yellow.geojson  # Yellow line route geometry
│   ├── purple.geojson  # Purple line route geometry
│   └── tram-train.geojson
├── lib/
│   └── (Leaflet & Turf loaded via CDN)
└── debug/
    └── mock-gps.js     # Fake GPS feed for testing
```

---

## Step-by-Step Build Order

### 1. Get the route data

Query the Overpass API for Supertram routes and export as GeoJSON:

```
[out:json];
relation["operator"="Stagecoach Supertram"];
out body;
>;
out skel qt;
```

Use [overpass-turbo.eu](https://overpass-turbo.eu/) to run the query, inspect the result, and export GeoJSON. Save one file per line in `routes/`.

### 2. Set up the map

```html
<!-- index.html -->
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<script src="https://unpkg.com/@turf/turf"></script>

<div id="map" style="height: 100vh;"></div>
```

```js
// app.js — bare minimum to get a map showing
const map = L.map('map').setView([53.38, -1.47], 13); // Sheffield centre
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);
```

### 3. Load and display a route

```js
fetch('routes/blue.geojson')
  .then(r => r.json())
  .then(geojson => {
    L.geoJSON(geojson, { style: { color: '#0074D9', weight: 4 } }).addTo(map);
  });
```

### 4. Add live GPS tracking

```js
const userMarker = L.circleMarker([0, 0], { radius: 8, color: '#e74c3c' }).addTo(map);

navigator.geolocation.watchPosition(pos => {
  const latlng = [pos.coords.latitude, pos.coords.longitude];
  userMarker.setLatLng(latlng);
}, err => console.error(err), { enableHighAccuracy: true });
```

### 5. Calculate progress along the line

```js
// Once you have the route GeoJSON and user position:
const point = turf.point([longitude, latitude]); // Note: Turf uses [lng, lat]
const snapped = turf.nearestPointOnLine(routeLine, point);

const totalLength = turf.length(routeLine, { units: 'kilometers' });
const start = turf.point(routeLine.geometry.coordinates[0]);
const sliced = turf.lineSlice(start, snapped, routeLine);
const travelled = turf.length(sliced, { units: 'kilometers' });

const progress = (travelled / totalLength) * 100;
// Display: "You are 42% along the Blue line (3.2 km / 7.6 km)"
```

### 6. Add a line selector

A simple dropdown or button group that lets the user pick Blue / Yellow / Purple / Tram Train. On change, load the corresponding GeoJSON and recalculate.

### 7. Add a progress bar UI

A visual bar at the top or bottom of the screen showing percentage, distance travelled, and distance remaining. Optionally mark tram stops along the bar.

---

## Testing Without Being on a Tram

**Option A — Chrome DevTools:** Open DevTools → ⋮ → More tools → Sensors → set a custom lat/lng.

**Option B — Mock GPS in code (recommended):**

```js
// debug/mock-gps.js
// Walk along the loaded route at simulated speed
function startMockGPS(routeGeoJSON, speedKmh = 30) {
  const line = turf.lineString(routeGeoJSON.geometry.coordinates);
  const totalKm = turf.length(line, { units: 'kilometers' });
  let distKm = 0;
  const intervalMs = 1000;
  const stepKm = speedKmh / 3600; // km per second

  setInterval(() => {
    distKm += stepKm;
    if (distKm > totalKm) distKm = 0; // loop
    const pt = turf.along(line, distKm, { units: 'kilometers' });
    const [lng, lat] = pt.geometry.coordinates;
    // Fire the same handler your real GPS uses
    onPositionUpdate({ coords: { latitude: lat, longitude: lng } });
  }, intervalMs);
}
```

Toggle with a `?debug=true` query parameter.

**Option C — GPX replay:** Draw a route at [gpx.studio](https://gpx.studio), export GPX, replay the points on a timer.

---

## Hosting & Deployment

1. Push your code to a **GitHub repo**
2. Go to [netlify.com](https://netlify.com), connect your repo
3. Set publish directory to `/` (or wherever `index.html` lives)
4. Every push auto-deploys

No build step needed if you're using vanilla JS. Add a `manifest.json` and service worker later if you want it installable as a PWA.

---

## Key Libraries & Links

- Leaflet: https://leafletjs.com
- Turf.js: https://turfjs.org
- Overpass Turbo: https://overpass-turbo.eu
- Netlify: https://netlify.com
- GPX Studio: https://gpx.studio