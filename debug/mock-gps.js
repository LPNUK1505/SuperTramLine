function startMockGPS(routeGeoJSON, speedKmh = 30) {
  // Extract the line — handles both FeatureCollection and Feature
  const feature = routeGeoJSON.type === 'FeatureCollection'
    ? routeGeoJSON.features[0]
    : routeGeoJSON;

  const line = turf.lineString(feature.geometry.coordinates);
  const totalKm = turf.length(line, { units: 'kilometers' });
  let distKm = 0;
  const intervalMs = 100;
  const stepKm = speedKmh / 3600 * (intervalMs / 1000);

  console.log(`Mock GPS started: ${totalKm.toFixed(2)} km at ${speedKmh} km/h`);

  return setInterval(() => {
    distKm += stepKm;
    if (distKm > totalKm) distKm = 0; // loop back to start

    const pt = turf.along(line, distKm, { units: 'kilometers' });
    const [lng, lat] = pt.geometry.coordinates;

    onPositionUpdate({
      coords: { latitude: lat, longitude: lng, accuracy: 5 }
    });
  }, intervalMs);
}