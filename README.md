# SuperTramLine

A mobile-friendly web app that shows your live GPS position on the Sheffield Supertram network. Tap a route to isolate it, then see your dot move along the line in real time.

## Features

- All four Supertram routes displayed on a live map (Blue, Yellow, Purple, Tram Train)
- Filter to a single route with toggle buttons — tap again to show all
- Tram stops shown per route, hiding/showing with their route
- Live GPS tracking via a "Locate Me" button
- Debug mode with a mock GPS that simulates riding a route
- Mobile-friendly layout with safe-area support for notched phones

## Project Structure

```
SuperTramLine/
├── index.html          # Main map page
├── debug.html          # Debug mode page (mock GPS)
├── app.js              # All map, route, GPS and button logic
├── style.css           # All styles (mobile-first)
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
| Route data | GeoJSON exported from OpenStreetMap via [Overpass Turbo](https://overpass-turbo.eu) |
| GPS | Browser Geolocation API (`watchPosition`) |
| Geometry | [Turf.js](https://turfjs.org) |
| Hosting | GitHub Pages |

## Running Locally

Open `index.html` via a local web server — the Geolocation API and `fetch()` calls to local GeoJSON files require a server context, not a plain `file://` URL.

A quick option with VS Code: install the **Live Server** extension and click "Go Live".

Or with Node:
```bash
npx serve .
```

## Debug Mode

Visit `debug.html` (or click the **Debug** button on the main page) to simulate GPS movement along any route without being on a tram. Select a route and click **Start Mock GPS** — the marker will travel the full line at average tram speed (~25 km/h).

## Known Issues & Platform Notes

### iOS Safari — GPS permission

iOS Safari requires geolocation to be triggered by a **user tap**, not automatically on page load. For this reason, GPS tracking only starts when you tap the **Locate Me** button.

If tapping the button produces no permission popup and no location:

> **Safari previously denied the permission silently.** This happens if the page ever called `watchPosition` on load before the button existed.

To fix:
1. On your iPhone/iPad go to **Settings → Privacy & Security → Location Services**
2. Scroll down to **Safari Websites** and set it to **While Using**

After resetting, tap Locate Me again — the permission popup will appear.

### HTTPS required

All modern mobile browsers block the Geolocation API on non-secure origins. The site must be served over **HTTPS** (GitHub Pages handles this automatically).

## Route Data

Route geometry and stop locations are sourced from OpenStreetMap. Stops are filtered per route using the `ref` tag on OSM relations:

| Route | OSM ref |
|---|---|
| Blue | `BLUE` |
| Yellow | `YELL` |
| Purple | `PURP` |
| Tram Train | `TT` |

To refresh the route data, query [Overpass Turbo](https://overpass-turbo.eu) for Sheffield Supertram relations and export as GeoJSON.
