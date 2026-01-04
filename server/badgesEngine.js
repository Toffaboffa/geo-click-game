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
    .replace(/[̀-ͯ]/g, "");
}

function cityNameEq(a, b) {
  if (!a || !b) return false;
  return normStr(a) === normStr(b);
}

function maxConsecutive(safeRounds, pred) {
  let best = 0;
  let cur = 0;
  for (let i = 0; i < safeRounds.length; i++) {
    if (pred(safeRounds[i], i)) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

function difficultyEq(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

function criteriaDifficultyPasses(criteria, matchDifficulty) {
  if (!criteria) return true;
  if (!criteria.difficulty) return true; // inget filter
  if (!matchDifficulty) return false; // badge kräver difficulty men vi fick ingen
  return difficultyEq(criteria.difficulty, matchDifficulty);
}

// Hämtar badges-katalog inkl. criteria. Cacheas 60s.
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
 *
 * Accepterar både den "nya" call-shapen (server/index.js) och den gamla.
 */
export function evaluateEligibleBadgeCodes({
  catalog,
  userStats, // { played, wins, losses, win_streak? ... ev wins_easy/wins_medium/wins_hard }
  isWinner,

  // Legacy call-shape
  totalScore, // match total (lägre bättre)
  rounds, // [{distanceKm,timeMs,score,city:{name,countryCode,population,isCapital?}}]
  oppTotalScore,
  oppRounds,

  // Optional
  difficulty, // match difficulty
  timeoutMs = 20_000,

  // Nyare call-shape (server/index.js)
  match,
  opponent,
  totalScores,
  username,
  winner,
} = {}) {
  const eligible = [];

  // ---------------------
  // Normalisering / bakåtkompat
  // ---------------------
  const effectiveDifficulty = difficulty ?? match?.difficulty ?? null;

  const normalizeRound = (r) => {
    if (!r || typeof r !== "object") return null;

    const citySrc = r.city ?? r.cityMeta ?? r.city_meta ?? null;
    const city = citySrc
      ? {
          name: citySrc?.name ?? null,
          countryCode: citySrc?.countryCode ?? citySrc?.country_code ?? null,
          population: citySrc?.population ?? null,
          isCapital: citySrc?.isCapital === true || citySrc?.is_capital === true,
        }
      : null;

    const dist = Number.isFinite(r.distanceKm)
      ? r.distanceKm
      : Number.isFinite(r.distance_km)
        ? r.distance_km
        : null;

    const time = Number.isFinite(r.timeMs)
      ? r.timeMs
      : Number.isFinite(r.time_ms)
        ? r.time_ms
        : null;

    const score = Number.isFinite(r.score) ? r.score : null;

    return {
      distanceKm: dist,
      timeMs: time,
      score,
      city,
      isTimeout: r.isTimeout ?? r.timedOut ?? r.is_timeout ?? null,
    };
  };

  const effectiveRoundsRaw = rounds ?? match?.rounds ?? [];
  const effectiveOppRoundsRaw = oppRounds ?? opponent?.rounds ?? [];

  const safeRounds = Array.isArray(effectiveRoundsRaw)
    ? effectiveRoundsRaw.map(normalizeRound).filter(Boolean)
    : [];
  const safeOppRounds = Array.isArray(effectiveOppRoundsRaw)
    ? effectiveOppRoundsRaw.map(normalizeRound).filter(Boolean)
    : [];

  const myTotal = toNum(
    totalScore ??
      (username != null && totalScores && typeof totalScores === "object" ? totalScores[username] : null)
  );

  const oppTotal = toNum(
    oppTotalScore ??
      opponent?.totalScore ??
      (opponent?.username != null && totalScores && typeof totalScores === "object"
        ? totalScores[opponent.username]
        : null)
  );

  const isWinnerResolved =
    typeof isWinner === "boolean"
      ? isWinner
      : winner != null && username != null
        ? winner === username
        : false;

  const played = toInt(userStats?.played) ?? 0;
  const wins = toInt(userStats?.wins) ?? 0;
  const winStreak = toInt(userStats?.win_streak) ?? toInt(userStats?.winStreak) ?? null;

  const playedChallenges =
    toInt(userStats?.played_challenges_total) ??
    toInt(userStats?.playedChallengesTotal) ??
    toInt(userStats?.playedChallenges) ??
    0;

  const winsChallenges =
    toInt(userStats?.wins_challenges_total) ??
    toInt(userStats?.winsChallengesTotal) ??
    toInt(userStats?.winsChallenges) ??
    0;

  const startedViaQueue =
    toInt(userStats?.started_matches_via_queue) ??
    toInt(userStats?.startedMatchesViaQueue) ??
    toInt(userStats?.startedViaQueue) ??
    0;

  const anyRound = (pred) => safeRounds.some((r, i) => pred(r, i));
  const countRounds = (pred) => safeRounds.reduce((acc, r, i) => acc + (pred(r, i) ? 1 : 0), 0);
  const allRounds = (pred) => safeRounds.length > 0 && safeRounds.every((r, i) => pred(r, i));

  for (const b of catalog || []) {
    const c = safeCriteria(b.criteria);
    if (!c?.type) continue;

    const t = String(c.type);

    const requiredDifficulty = c.difficulty;
    const difficultyOk =
      requiredDifficulty == null || requiredDifficulty === ""
        ? true
        : difficultyEq(effectiveDifficulty, requiredDifficulty);

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

    // --- Social totals
    if (t === "played_challenges_total") {
      const min = toInt(c.min) ?? 0;
      if (playedChallenges >= min) eligible.push(b.code);
      continue;
    }

    if (t === "wins_challenges_total") {
      const min = toInt(c.min) ?? 0;
      if (winsChallenges >= min) eligible.push(b.code);
      continue;
    }

    if (t === "started_matches_via_queue") {
      const min = toInt(c.min) ?? 0;
      if (startedViaQueue >= min) eligible.push(b.code);
      continue;
    }

    // --- Wins by difficulty (historik)
    if (t === "wins_by_difficulty") {
      const min = toInt(c.min) ?? 0;
      const d = String(c.difficulty ?? "").toLowerCase();
      if (!d) continue;

      const keySnake = `${d}_wins`; // easy_wins, medium_wins, hard_wins (din DB)
      const keyAltSnake = `wins_${d}`; // wins_easy (fallback)
      const keyCamel = `wins${d[0]?.toUpperCase?.() ?? ""}${d.slice(1)}`; // winsEasy (fallback)

      const v =
        toInt(userStats?.[keySnake]) ??
        toInt(userStats?.[keyAltSnake]) ??
        toInt(userStats?.[keyCamel]) ??
        toInt(userStats?.winsByDifficulty?.[d]) ??
        null;

      if (v != null && v >= min) eligible.push(b.code);
      continue;
    }

    // --- Played by difficulty (historik)
    if (t === "played_by_difficulty") {
      const min = toInt(c.min) ?? 0;
      const d = String(c.difficulty ?? "").toLowerCase();
      if (!d) continue;

      const keySnake = `${d}_played`; // easy_played, medium_played, hard_played (din DB)
      const keyAltSnake = `played_${d}`; // played_easy (fallback)
      const keyCamel = `played${d[0]?.toUpperCase?.() ?? ""}${d.slice(1)}`; // playedEasy (fallback)

      const v =
        toInt(userStats?.[keySnake]) ??
        toInt(userStats?.[keyAltSnake]) ??
        toInt(userStats?.[keyCamel]) ??
        toInt(userStats?.playedByDifficulty?.[d]) ??
        null;

      if (v != null && v >= min) eligible.push(b.code);
      continue;
    }


    // --- Lose-badges (hanteras INNAN vi skippar losers)
    if (t === "lose_match_by_margin_under_score") {
      if (!difficultyOk) continue;
      const maxMargin = toNum(c.max_margin);
      if (maxMargin == null) continue;
      if (isWinnerResolved) continue;
      if (myTotal == null || oppTotal == null) continue;

      const margin = myTotal - oppTotal; // losing => >0 (lägre är bättre)
      if (margin > 0 && margin < maxMargin) eligible.push(b.code);
      continue;
    }

    // --- Allt nedan kräver vinst i matchen
    if (!isWinnerResolved) continue;

    // --- Difficulty-filter
    if (!criteriaDifficultyPasses(c, effectiveDifficulty)) continue;

    // --- Distance/time
    if (t === "win_match_distance_any_round_under_km") {
      if (!difficultyOk) continue;
      const maxKm = toNum(c.max_km);
      if (maxKm == null) continue;
      if (anyRound((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm)) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_distance_rounds_under_km") {
      if (!difficultyOk) continue;
      const maxKm = toNum(c.max_km);
      const minRounds = toInt(c.min_rounds) ?? 0;
      if (maxKm == null) continue;
      const n = countRounds((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm);
      if (n >= minRounds) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_round_under_combo") {
      if (!difficultyOk) continue;
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
      if (!difficultyOk) continue;
      const maxKm = toNum(c.max_km);
      if (maxKm == null) continue;
      if (allRounds((r) => (toNum(r.distanceKm) ?? Infinity) < maxKm)) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_no_round_over_km") {
      if (!difficultyOk) continue;
      const maxKm = toNum(c.max_km);
      if (maxKm == null) continue;
      if (allRounds((r) => (toNum(r.distanceKm) ?? Infinity) <= maxKm)) eligible.push(b.code);
      continue;
    }

    // --- Total score thresholds (lägre bättre)
    if (t === "win_match_under_total_score") {
      if (!difficultyOk) continue;
      const maxTotal = toNum(c.max_total_score);
      if (maxTotal == null) continue; // null = "definieras senare"
      if ((myTotal ?? Infinity) < maxTotal) eligible.push(b.code);
      continue;
    }

    // --- Avg time thresholds
    if (t === "win_match_avg_time_under_s") {
      if (!difficultyOk) continue;
      const maxAvg = toNum(c.max_avg_time_s);
      if (maxAvg == null) continue; // null = "definieras senare"
      if (safeRounds.length === 0) continue;
      const avg =
        safeRounds.reduce((a, r) => a + ((toNum(r.timeMs) ?? 0) / 1000), 0) / safeRounds.length;
      if (avg < maxAvg) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_no_round_over_time_s") {
      if (!difficultyOk) continue;
      const maxTimeS = toNum(c.max_time_s);
      if (maxTimeS == null) continue;
      if (allRounds((r) => ((toNum(r.timeMs) ?? Infinity) / 1000) <= maxTimeS)) eligible.push(b.code);
      continue;
    }

    // --- Timeout based
    if (t === "win_match_with_any_round_timeout") {
      if (!difficultyOk) continue;
      // Servern kan ge oss antingen per-runda timeMs/isTimeout, eller en precomputed flagga.
      if (match?.hasTimeoutRound === true) {
        eligible.push(b.code);
        continue;
      }
      const ok = anyRound((r) => {
        if (r?.isTimeout === true) return true;
        const ms = toNum(r?.timeMs);
        if (ms == null) return false;
        return ms >= timeoutMs;
      });
      if (ok) eligible.push(b.code);
      continue;
    }

    // --- Streaks (consecutive rounds)
    if (t === "match_consecutive_rounds_under_km") {
      if (!difficultyOk) continue;
      const maxKm = toNum(c.max_km);
      const streak = toInt(c.streak) ?? 0;
      if (maxKm == null || streak <= 0) continue;
      const best = maxConsecutive(safeRounds, (r) => (toNum(r.distanceKm) ?? Infinity) < maxKm);
      if (best >= streak) eligible.push(b.code);
      continue;
    }

    if (t === "match_consecutive_rounds_under_time_s") {
      if (!difficultyOk) continue;
      const maxTimeS = toNum(c.max_time_s);
      const streak = toInt(c.streak) ?? 0;
      if (maxTimeS == null || streak <= 0) continue;
      const best = maxConsecutive(
        safeRounds,
        (r) => ((toNum(r.timeMs) ?? Infinity) / 1000) < maxTimeS
      );
      if (best >= streak) eligible.push(b.code);
      continue;
    }

    // --- City-based special
    if (t === "win_match_closest_to_city") {
      const city = c.city;
      if (!city) continue;

      const ok = anyRound((r, i) => {
        const rr = r?.city;
        const or = safeOppRounds[i]?.city;

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
      // Per match (inte historiskt)
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
      if (!difficultyOk) continue;
      const minKm = toNum(c.min_km);
      if (minKm == null) continue;
      if (anyRound((r) => (toNum(r.distanceKm) ?? -Infinity) > minKm)) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_all_cities_under_population") {
      if (!difficultyOk) continue;
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
      if (!difficultyOk) continue;
      const minCaps = toInt(c.min_capitals) ?? 0;
      if (minCaps <= 0) continue;
      const caps = countRounds((r) => r?.city?.isCapital === true);
      if (caps >= minCaps) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_min_cities_over_population") {
      if (!difficultyOk) continue;
      const minCities = toInt(c.min_cities) ?? 0;
      const minPop = toInt(c.min_population);
      if (minCities <= 0 || minPop == null) continue;
      const n = countRounds((r) => {
        const pop = toInt(r?.city?.population);
        if (pop == null) return false;
        return pop >= minPop;
      });
      if (n >= minCities) eligible.push(b.code);
      continue;
    }

    // --- Comeback/extremfall
    if (t === "win_match_after_losing_first_n_rounds") {
      if (!difficultyOk) continue;
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
      if (!difficultyOk) continue;
      if (safeRounds.length < 1) continue;

      const lastIdx = safeRounds.length - 1;

      const myBefore = safeRounds.slice(0, lastIdx).reduce((a, r) => a + (toNum(r.score) ?? 0), 0);
      const opBefore = safeOppRounds
        .slice(0, lastIdx)
        .reduce((a, r) => a + (toNum(r.score) ?? 0), 0);

      const wasNotWinningBefore = myBefore >= opBefore; // högre = sämre
      const nowWinning = (myTotal ?? Infinity) < (oppTotal ?? Infinity);

      if (wasNotWinningBefore && nowWinning) eligible.push(b.code);
      continue;
    }

    if (t === "win_match_with_rounds_lost_by_score") {
      if (!difficultyOk) continue;
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
