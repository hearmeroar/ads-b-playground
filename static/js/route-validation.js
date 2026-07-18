// --- Layer 2: geometric validation of adsbdb-sourced routes ---
// adsbdb's flightroute comes from a historical callsign->route lookup, not
// a live flight plan, so it's a hypothesis, not ground truth (reused
// callsigns, schedule/seasonal changes, irregular ops all produce wrong
// matches). This answers one narrow question: "does this aircraft's
// current kinematic state (position/track/speed/altitude) look consistent
// with flying the claimed origin->destination route?" — deterministic, no
// external calls, standard spherical-navigation formulas (Ed Williams'
// Aviation Formulary; not novel math). Deliberately scoped to adsbdb routes
// only (see buildMergedDetails()) — FlightAware's route comes from a live
// paid tracking service, not a historical guess, so it doesn't need this.
const EARTH_RADIUS_KM = 6371;

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Point at a given distance+bearing from an origin (standard spherical
// "destination point" formula, same Aviation Formulary family as
// initialBearingDeg above) — used to place the scan-radius ring labels
// (map-init.js) at true north of the map center.
function destinationPoint(lat, lon, bearingDeg, distanceKm) {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat), lambda1 = toRad(lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
  );
  return { lat: toDeg(phi2), lon: toDeg(lambda2) };
}

function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest angle between two bearings, 0-180 — e.g. angleDiffDeg(350, 10) is
// 20, not 340.
function angleDiffDeg(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Standard cross-track/along-track pair, sharing the intermediate angular
// distance (delta13) and bearings (theta13/theta12) from origin to current
// position and origin to destination respectively.
function crossTrackDistanceKm(originLat, originLon, destLat, destLon, curLat, curLon) {
  const delta13 = haversineDistanceKm(originLat, originLon, curLat, curLon) / EARTH_RADIUS_KM;
  const theta13 = toRad(initialBearingDeg(originLat, originLon, curLat, curLon));
  const theta12 = toRad(initialBearingDeg(originLat, originLon, destLat, destLon));
  return Math.asin(Math.sin(delta13) * Math.sin(theta13 - theta12)) * EARTH_RADIUS_KM;
}

function alongTrackDistanceKm(originLat, originLon, destLat, destLon, curLat, curLon) {
  const delta13 = haversineDistanceKm(originLat, originLon, curLat, curLon) / EARTH_RADIUS_KM;
  const dxt = crossTrackDistanceKm(originLat, originLon, destLat, destLon, curLat, curLon) / EARTH_RADIUS_KM;
  // Guard against a tiny floating-point overshoot of acos's [-1, 1] domain
  // when the aircraft sits almost exactly on the great circle.
  const ratio = Math.min(1, Math.max(-1, Math.cos(delta13) / Math.cos(dxt)));
  return Math.acos(ratio) * EARTH_RADIUS_KM;
}

function routeProgressPercent(originLat, originLon, destLat, destLon, curLat, curLon) {
  const total = haversineDistanceKm(originLat, originLon, destLat, destLon);
  if (total === 0) return 0;
  const along = alongTrackDistanceKm(originLat, originLon, destLat, destLon, curLat, curLon);
  return (along / total) * 100;
}

// Piecewise-linear interpolation between control points [[x, fraction], ...]
// (x ascending) — a smooth, continuous stand-in for the spec's discrete
// Excellent/Good/Weak/Invalid bands, rather than a cliff-edged step function.
function interpolateFraction(value, points) {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (value <= x1) return y0 + (y1 - y0) * (value - x0) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

function trackAlignmentScore(diffDeg) {
  return interpolateFraction(diffDeg, [[0, 1], [20, 1], [45, 0.6], [70, 0.25], [180, 0]]);
}

function distanceToRouteScore(distanceKm) {
  return interpolateFraction(Math.abs(distanceKm), [[0, 1], [50, 1], [150, 0.6], [300, 0.2], [300.0001, 0]]);
}

function routeProgressScore(percent) {
  if (percent >= 0 && percent <= 100) return 1;
  const overshoot = percent < 0 ? -percent : percent - 100;
  return Math.max(0, 1 - overshoot / 50);
}

// Expected phase of flight from route progress: near either end of the
// route ("terminal", climb/descent) an aircraft should look meaningfully
// different from mid-route ("cruise") — a cruise-altitude/cruise-speed
// aircraft that's supposedly still right next to the departure airport (or
// already past the destination) is the contradiction this flags. Smooth,
// not a hard cutoff, since aircraft types/climb profiles vary hugely — a
// reasonable heuristic, not validated aviation science, and the two
// lightest-weighted checks (10 + 5 of 100 points) for exactly that reason.
function terminalness(percent) {
  if (percent <= 8) return 1 - percent / 8;
  if (percent >= 92) return (percent - 92) / 8;
  return 0; // solidly mid-route ("cruise") — no terminal-phase expectation
}

function speedPlausibilityScore(percent, speedKmh) {
  const term = terminalness(percent);
  if (term <= 0 || speedKmh == null) return { fraction: 1, note: 'cruise phase — no penalty' };
  // A high cruise-like ground speed (~800+ km/h) while deep in terminal
  // territory is the suspicious case from the spec's own examples.
  const excess = Math.max(0, (speedKmh - 500) / 400); // 0 at 500 km/h, 1 at 900 km/h
  const fraction = Math.max(0, 1 - term * Math.min(1, excess));
  return { fraction, note: `terminal phase (${(term * 100).toFixed(0)}%), speed ${speedKmh.toFixed(0)} km/h` };
}

function altitudePlausibilityScore(percent, altitudeM) {
  const term = terminalness(percent);
  if (term <= 0 || altitudeM == null) return { fraction: 1, note: 'cruise phase — no penalty' };
  // A high cruise altitude (~8000m+/FL260+) while deep in terminal
  // territory is the suspicious case (the spec's own FL380-near-departure
  // example).
  const excess = Math.max(0, (altitudeM - 5000) / 5000); // 0 at 5000m, 1 at 10000m
  const fraction = Math.max(0, 1 - term * Math.min(1, excess));
  return { fraction, note: `terminal phase (${(term * 100).toFixed(0)}%), altitude ${altitudeM.toFixed(0)}m` };
}

// Past this cross-track distance, the aircraft isn't meaningfully "on" the
// claimed route at all — same boundary distanceToRouteScore already floors
// its own fraction to 0 at, reused here as a hard gate on the total score.
const DISTANCE_GATE_KM = 300;
const ROUTE_CONFIDENCE_BASELINE = 30;
const ROUTE_CONFIDENCE_BANDS = [
  [96, 'very_high'], [80, 'high'], [60, 'medium'], [40, 'low'], [0, 'reject'],
];
function routeConfidenceBand(score) {
  for (const [min, band] of ROUTE_CONFIDENCE_BANDS) if (score >= min) return band;
  return 'reject';
}

// Orchestrates every check above into one composite result. All lat/lon/
// track/speed/altitude inputs are required except trackDeg/speedKmh/
// altitudeM, which degrade that specific check to a no-penalty pass rather
// than failing the whole computation (an aircraft can genuinely lack one of
// these on a given poll).
function validateAdsbdbRoute({ curLat, curLon, trackDeg, speedKmh, altitudeM, originLat, originLon, destLat, destLon }) {
  const distanceKm = crossTrackDistanceKm(originLat, originLon, destLat, destLon, curLat, curLon);
  const percent = routeProgressPercent(originLat, originLon, destLat, destLon, curLat, curLon);

  let diffDeg = null, trackFraction = 1;
  if (trackDeg != null) {
    const bearingToDest = initialBearingDeg(curLat, curLon, destLat, destLon);
    diffDeg = angleDiffDeg(trackDeg, bearingToDest);
    trackFraction = trackAlignmentScore(diffDeg);
  }
  const distFraction = distanceToRouteScore(distanceKm);
  const progressFraction = routeProgressScore(percent);
  const speed = speedPlausibilityScore(percent, speedKmh);
  const alt = altitudePlausibilityScore(percent, altitudeM);

  const checks = {
    trackAlignment: { diffDeg, points: trackFraction * 20 },
    distanceToRoute: { distanceKm, points: distFraction * 25 },
    routeProgress: { percent, points: progressFraction * 10 },
    speedPlausibility: { points: speed.fraction * 10, note: speed.note },
    altitudePlausibility: { points: alt.fraction * 5, note: alt.note },
  };
  let score = ROUTE_CONFIDENCE_BASELINE
    + checks.trackAlignment.points + checks.distanceToRoute.points
    + checks.routeProgress.points + checks.speedPlausibility.points + checks.altitudePlausibility.points;

  // Hard gate: cross-track distance alone only carries 25 of 100 points, so
  // an aircraft that's flatly nowhere near the claimed route (a different
  // flight entirely, not just a slightly-off one) could still land in
  // "Medium" territory on the strength of the other four checks alone —
  // confirmed against a real live mismatch (a Norse Atlantic 787 over
  // Bosnia whose callsign adsbdb resolved to an unrelated IndiGo Mumbai->
  // Manchester flight, ~760km cross-track, scored 74.6/Medium before this
  // gate). Past DISTANCE_GATE_KM the aircraft simply isn't on this route in
  // any meaningful sense, so the total is capped into Reject regardless of
  // how plausible the other checks happen to look in isolation.
  if (Math.abs(distanceKm) > DISTANCE_GATE_KM) score = Math.min(score, 39);

  return { score, band: routeConfidenceBand(score), checks };
}
