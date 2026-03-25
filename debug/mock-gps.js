function startMockGPS(routeGeoJSON, speedKmh = 30, startKm = null, getDirection = () => 1) {
  // Extract the line — handles both FeatureCollection and Feature
  const feature = routeGeoJSON.type === 'FeatureCollection'
    ? routeGeoJSON.features[0]
    : routeGeoJSON;

  const line = turf.lineString(feature.geometry.coordinates);
  const totalKm = turf.length(line, { units: 'kilometers' });
  // null means "no explicit start": begin at route start (fwd) or end (rev)
  let distKm = startKm === null
    ? (getDirection() > 0 ? 0 : totalKm)
    : Math.min(Math.max(startKm, 0), totalKm);
  const intervalMs = 100;
  const stepKm = speedKmh / 3600 * (intervalMs / 1000);

  console.log(`Mock GPS started: ${totalKm.toFixed(2)} km at ${speedKmh} km/h, from ${distKm.toFixed(2)} km, dir ${getDirection() > 0 ? 'fwd' : 'rev'}`);

  const id = setInterval(() => {
    distKm += stepKm * getDirection();
    if (distKm > totalKm) distKm = 0;
    if (distKm < 0) distKm = totalKm;

    const pt = turf.along(line, distKm, { units: 'kilometers' });
    const [lng, lat] = pt.geometry.coordinates;

    onPositionUpdate({
      coords: { latitude: lat, longitude: lng, accuracy: 5 }
    });
  }, intervalMs);

  return { id, getDistKm: () => distKm };
}
