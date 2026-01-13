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
  maxDistanceKm = 17000,
  maxTimeMs = 20000,
  {
    distPoints = 1000,
    timePoints = 1000,
    timeCurve = "exp",   // "exp" eller "power"
    timeK = 3.2,
    timeGamma = 1.0,
  } = {}
) {
  return function score(distanceKm, timeMs) {
    const distPenalty = Math.min(Number(distanceKm) / maxDistanceKm, 1);

    const tNorm = Math.min(Math.max(Number(timeMs) / maxTimeMs, 0), 1);

    let timePenalty = tNorm;
    if (timeCurve === "exp") {
      const k = Number(timeK);
      timePenalty =
        Number.isFinite(k) && k > 0 ? Math.expm1(k * tNorm) / Math.expm1(k) : tNorm;
    } else {
      timePenalty = Math.pow(tNorm, timeGamma);
    }

    return distPenalty * distPoints + timePenalty * timePoints;
  };
}



