# SuperTramLine

**Live GPS tracker for the Sheffield Supertram network.**

[![Live Site](https://img.shields.io/badge/Live%20Site-GitHub%20Pages-blue)](https://lpnuk1505.github.io/SuperTramLine/)

Ever sat on a Sheffield Supertram wondering how far along you are? Google Maps can tell you — if you punch in a destination, pick the right transport mode, and squint at the results. SuperTramLine skips all that. Open it, tap **Locate Me**, and see your live position on the route with how far there is to go. No fuss.

---

## Features

- All four Supertram routes on a live map — Blue, Yellow, Purple, Tram Train
- Tap a route button to isolate it; tap again to show all
- Stops shown per route, toggling with their route
- Live GPS tracking via the **Locate Me** button
- Debug mode with a mock GPS that simulates riding any route at real tram speed

## Usage

Open the [live site](https://lpnuk1505.github.io/SuperTramLine/) on your phone while on a tram:

1. Tap **Locate Me** to start GPS tracking
2. Tap a route colour to filter the map to that line
3. Your dot will move along the route in real time

Use **Debug mode** to simulate a journey without being on a tram — useful for testing or just exploring the routes.

## Running Locally

The Geolocation API and GeoJSON file loading both require a server context — a plain `file://` URL won't work.

**VS Code** — install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension and click **Go Live**.

**Node:**
```bash
npx serve .
```

Then open `http://localhost:3000` (or whatever port is shown).

## Debug Mode

Visit `debug.html` or click the **Debug** button on the main page. Select a route and click **Start Mock GPS** — the marker will travel the full line at ~25 km/h, matching average tram speed.

## Project Structure

```
SuperTramLine/
├── index.html          # Main map page
├── debug.html          # Debug mode page (mock GPS)
├── app.js              # Map, route, GPS, and button logic
├── style.css           # Mobile-first styles with safe-area support
├── routes/
│   ├── blue.geojson
│   ├── yellow.geojson
│   ├── purple.geojson
│   ├── tram-train.geojson
│   └── stops.geojson
└── debug/
    └── mock-gps.js     # Simulates GPS movement along a route
```

## Tech Stack

| Layer | Tool |
|---|---|
| Map | [Leaflet.js](https://leafletjs.org) + OpenStreetMap tiles |
| Route data | GeoJSON from [Overpass Turbo](https://overpass-turbo.eu) |
| GPS | Browser Geolocation API (`watchPosition`) |
| Geometry | [Turf.js](https://turfjs.org) |
| Hosting | GitHub Pages |

## Known Issues & Platform Notes

### iOS Safari — GPS permission

iOS Safari requires geolocation to be triggered by a user tap, not on page load. GPS tracking only starts when you tap **Locate Me** for this reason.

If tapping the button produces no permission popup and no location, Safari may have silently denied permission previously. To reset it:

1. Go to **Settings → Privacy & Security → Location Services**
2. Scroll to **Safari Websites** and set it to **While Using**

Then tap Locate Me again — the permission prompt will appear.

### HTTPS required

All modern mobile browsers block the Geolocation API on non-secure origins. The site must be served over HTTPS — GitHub Pages handles this automatically.

## Route Data

Route geometry and stop locations are sourced from OpenStreetMap, filtered by the `ref` tag on Supertram relations:

| Route | OSM ref |
|---|---|
| Blue | `BLUE` |
| Yellow | `YELL` |
| Purple | `PURP` |
| Tram Train | `TT` |

To refresh route data, query [Overpass Turbo](https://overpass-turbo.eu) for Sheffield Supertram relations and export as GeoJSON.
