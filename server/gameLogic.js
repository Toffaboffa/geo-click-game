// server/gameLogic.js

// Haversine: avstånd i km mellan två lat/lon
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// server/gameLogic.js
export function createRoundScorer(
  maxDistanceKm = 20000,
  maxTimeMs = 20000,
  { distW = 1.0, timeW = 0.30, timeGamma = 1.0 } = {}
) {
  return function score(distanceKm, timeMs) {
    const distPenalty = Math.min(distanceKm / maxDistanceKm, 1);

    // timeGamma: 1.0 = linjärt, >1 gör att tid straffar mindre tidigt (och mer sent)
    const tNorm = Math.min(timeMs / maxTimeMs, 1);
    const timePenalty = Math.pow(tNorm, timeGamma);

    // viktad medelpoäng, normaliserad så max fortfarande blir 2000
    const weighted = (distW * distPenalty + timeW * timePenalty) / (distW + timeW);
    return weighted * 2000;
  };
}


