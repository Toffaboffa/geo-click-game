// server/badgesEngine.js
// Badge-evaluator + katalog-cache
// - Stödjer criteria-typerna i din Supabase-tabell
// - Trösklar som är null (t.ex. Lightning Mind / Speedrunner) är "disabled" tills du sätter värden.
// - Normaliserar strängar med diakritik (Malmö ≈ Malmo, São ≈ Sao) för robust city-matchning.

let _cachedCatalog = null;
let _cachedAt = 0;
const CATALOG_TTL_MS = 60_000;

function toInt(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).replace(/[^\d-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeCriteria(c) {
  if (!c) return null;
  if (typeof c === "object") return c;
  try {
    return JSON.parse(c);
  } catch {
    return null;
  }
}

function roundScoreWinnerIsPlayer(playerScore, oppScore) {
  // lägre score = bättre
  if (playerScore == null && oppScore == null) return null;
  const ps = typeof playerScore === "number" ? playerScore : Number.POSITIVE_INFINITY;
  const os = typeof oppScore === "number" ? oppScore : Number.POSITIVE_INFINITY;
  if (ps < os) return true;
  if (os < ps) return false;
  return null;
}

function normStr(x) {
  // Robust sträng-normalisering:
  // - trim/lowercase
  // - normalize NFD + ta bort combining marks -> tar bort diakritik (å/ä/ö/é/í/ø/ã...)
  return String(x ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cityNameEq(a, b) {
  if (!a || !b) return false;
  return normStr(a) === normStr(b);
}

/**
 * Hämtar badges-katalog inkl. criteria. Cacheas 60s.
 * @param {object} db - pg Pool eller pg Client (måste ha .query)
 */
export async function getBadgesCatalogWithCriteria(db) {
  const now = Date.now();
  if (_cachedCatalog && now - _cachedAt < CATALOG_TTL_MS) return _cachedCatalog;

  const { rows } = await db.query(
    `select
       id,
       code,
       group_key as "groupKey",
       group_name as "groupName",
       sort_in_group as "sortInGroup",
       name,
       description,
       emoji,
       icon_url as "iconUrl",
       criteria
     from public.badges
     order by group_key asc, sort_in_group asc, id asc`
  );

  const catalog = rows.map((r) => ({
    ...r,
    criteria: safeCriteria(r.criteria),
  }));

  _cachedCatalog = catalog;
  _cachedAt = now;
  return catalog;
}

export function mapBadgesByCode(catalog) {
  const m = new Map();
  for (const b of catalog || []) m.set(b.code, b);
  return m;
}

/**
 * Räknar vilka badge codes som är "eligible" för en user givet match + stats.
 * Returnerar *alla* eligible codes (servern filtrerar bort redan-earned via SQL eller prefilter).
 */
export function evaluateEligibleBadgeCodes({
  catalog,
  userStats, // { played, wins, losses, win_streak? }
  isWinner,
  totalScore, // match total (lägre bättre)
  rounds, // [{distanceKm,timeMs,score,city:{name,countryCode,population,isCapital?}}]
  oppTotalScore,
  oppRounds,
}) {
  const eligible = [];
  const played = toInt(userStats?.played) ?? 0;
  const wins = toInt(userStats?.wins) ?? 0;
  const winStreak = toInt(userStats?.win_streak) ?? toInt(userStats?.winStreak) ?? null;

  const safeRounds = Array.isArray(rounds) ? rounds : [];
  const safeOppRounds = Array.isArray(oppRounds) ? oppRounds : [];

  const anyRound = (pred) => safeRounds.some((r, i) => pred(r, i));
  const countRounds = (pred) => safeRounds.reduce((acc, r, i) => acc + (pred(r, i) ? 1 : 0), 0);
  const allRounds = (pred) => safeRounds.length > 0 && safeRounds.every((r, i) => pred(r, i));

  for (const b of catalog || []) {
    const c = safeCriteria(b.criteria);
    if (!c?.type) continue;

    const t = String(c.type);

    // --- Totals (oberoende av matchdata)
    if (t === "wins_total") {
      const min = toInt(c.min) ?? 0;
      if (wins >= min) eligible.push(b.code);
      continue;
    }

    if (t === "played_total") {
      const min = toInt(c.min) ?? 0;
      if (played >= min) eligible.push(b.code);
      continue;
    }

    if (t === "win_streak") {
      const min = toInt(c.min) ?? 0;
      if (winStreak != null && winStreak >= min) eligible.push(b.code);
      continue;
    }

    // --- Allt nedan kräver vinst i matchen
    if (!isWinner) continue;

    // --- Distance/time
    if (t === "win_match_distance_any_round_under_km") {
      const maxKm = toNum(c.max_km);
      if (maxKm == null) continue;
      if (anyRound((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm)) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_distance_rounds_under_km") {
      const maxKm = toNum(c.max_km);
      const minRounds = toInt(c.min_rounds) ?? 0;
      if (maxKm == null) continue;
      const n = countRounds((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm);
      if (n >= minRounds) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_round_under_combo") {
      const maxKm = toNum(c.max_km);
      const maxTimeS = toNum(c.max_time_s);
      if (maxKm == null || maxTimeS == null) continue;
      const ok = anyRound((r) => {
        const km = toNum(r.distanceKm) ?? Infinity;
        const ts = (toNum(r.timeMs) ?? Infinity) / 1000;
        return km < maxKm && ts < maxTimeS;
      });
      if (ok) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_all_rounds_under_km") {
      const maxKm = toNum(c.max_km);
      if (maxKm == null) continue;
      if (allRounds((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm)) eligible.push(b.code);
      continue;
    }

    // --- Total score thresholds (lägre bättre)
    if (t === "win_match_under_total_score") {
      const maxTotal = toNum(c.max_total_score);
      if (maxTotal == null) continue; // null = "definieras senare"
      if ((toNum(totalScore) ?? Infinity) < maxTotal) eligible.push(b.code);
      continue;
    }

    // --- Avg time thresholds
    if (t === "win_match_avg_time_under_s") {
      const maxAvg = toNum(c.max_avg_time_s);
      if (maxAvg == null) continue; // null = "definieras senare"
      if (safeRounds.length === 0) continue;
      const avg =
        safeRounds.reduce((a, r) => a + ((toNum(r.timeMs) ?? 0) / 1000), 0) / safeRounds.length;
      if (avg < maxAvg) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_no_round_over_time_s") {
      const maxTimeS = toNum(c.max_time_s);
      if (maxTimeS == null) continue;
      if (allRounds((r) => ((toNum(r.timeMs) ?? Infinity) / 1000) <= maxTimeS)) eligible.push(b.code);
      continue;
    }

    // --- City-based special
    if (t === "win_match_closest_to_city") {
      const city = c.city;
      if (!city) continue;

      const ok = anyRound((r, i) => {
        const rr = r?.city;
        const or = safeOppRounds[i]?.city;

        // Notera: här matchar vi mot antingen din eller motståndarens "city" i rundan.
        // (Beteendet kan justeras om du vill att det strikt ska vara "staden du själv fick".)
        const cityMatch = cityNameEq(rr?.name, city) || cityNameEq(or?.name, city);
        if (!cityMatch) return false;

        const myKm = toNum(r.distanceKm) ?? Infinity;
        const oppKm = toNum(safeOppRounds[i]?.distanceKm) ?? Infinity;
        return myKm < oppKm;
      });

      if (ok) eligible.push(b.code);
      continue;
    }

    if (t === "wins_closest_in_country_cities") {
      // Tolkning (utan historik): i DENNA matchen
      const country = c.country;
      const minCities = toInt(c.min_cities) ?? 0;
      if (!country || minCities <= 0) continue;

      const distinct = new Set();
      for (let i = 0; i < safeRounds.length; i++) {
        const r = safeRounds[i];
        const rr = r?.city;
        if (!rr) continue;
        if (String(rr.countryCode || "").toUpperCase() !== String(country).toUpperCase()) continue;

        const myKm = toNum(r.distanceKm) ?? Infinity;
        const oppKm = toNum(safeOppRounds[i]?.distanceKm) ?? Infinity;
        if (myKm < oppKm) distinct.add(String(rr.name));
      }

      if (distinct.size >= minCities) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_with_any_round_over_km") {
      const minKm = toNum(c.min_km);
      if (minKm == null) continue;
      if (anyRound((r) => (toNum(r.distanceKm) ?? -Infinity) > minKm)) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_all_cities_under_population") {
      const maxPop = toInt(c.max_population);
      if (maxPop == null) continue;
      const ok = allRounds((r) => {
        const pop = toInt(r?.city?.population);
        if (pop == null) return false;
        return pop < maxPop;
      });
      if (ok) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_min_capitals") {
      // Kräver city.isCapital i match-analytics (servern måste supply:a detta)
      const minCaps = toInt(c.min_capitals) ?? 0;
      if (minCaps <= 0) continue;
      const caps = countRounds((r) => r?.city?.isCapital === true);
      if (caps >= minCaps) eligible.push(b.code);
      continue;
    }

    // --- Comeback/extremfall
    if (t === "win_match_after_losing_first_n_rounds") {
      const n = toInt(c.n) ?? 0;
      if (n <= 0) continue;

      let lostCount = 0;
      for (let i = 0; i < Math.min(n, safeRounds.length); i++) {
        const my = toNum(safeRounds[i]?.score);
        const op = toNum(safeOppRounds[i]?.score);
        const w = roundScoreWinnerIsPlayer(my, op);
        if (w === false) lostCount += 1;
      }

      if (lostCount >= n) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_last_round_decides") {
      if (safeRounds.length < 1) continue;

      const lastIdx = safeRounds.length - 1;

      const myBefore = safeRounds.slice(0, lastIdx).reduce((a, r) => a + (toNum(r.score) ?? 0), 0);
      const opBefore = safeOppRounds
        .slice(0, lastIdx)
        .reduce((a, r) => a + (toNum(r.score) ?? 0), 0);

      // Inte vinnande före sista rundan (tied eller efter)
      const wasNotWinningBefore = myBefore >= opBefore; // högre = sämre
      const nowWinning = (toNum(totalScore) ?? Infinity) < (toNum(oppTotalScore) ?? Infinity);

      if (wasNotWinningBefore && nowWinning) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_with_rounds_lost_by_score") {
      const minLost = toInt(c.min_rounds_lost) ?? 0;
      if (minLost <= 0) continue;

      let lostRounds = 0;
      for (let i = 0; i < safeRounds.length; i++) {
        const my = toNum(safeRounds[i]?.score);
        const op = toNum(safeOppRounds[i]?.score);
        const w = roundScoreWinnerIsPlayer(my, op);
        if (w === false) lostRounds += 1;
      }

      if (lostRounds >= minLost) eligible.push(b.code);
      continue;
    }

    // okända types ignoreras (framtida expansion)
  }

  return eligible;
}
