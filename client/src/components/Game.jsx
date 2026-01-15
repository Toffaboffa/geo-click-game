// client/src/components/Game.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useI18n } from "../i18n/LanguageProvider.jsx";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function shortCityName(name) {
  if (!name) return "";
  return String(name).split(",")[0].trim();
}
function fmtMs(ms) {
  const s = (ms ?? 0) / 1000;
  return s.toFixed(2);
}
function fmtScore(v) {
  if (!Number.isFinite(v)) return "—";
  return String(Math.round(v));
}
function fmtKm(v) {
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v)} km`;
}
function fmtKmCompact(v) {
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v)}km`;
}
function fmtSecFromMs(v) {
  if (!Number.isFinite(v)) return "—";
  return `${((v ?? 0) / 1000).toFixed(2)}s`;
}

// Gör en Twemoji (SVG) URL för en flagga baserat på ISO-2 landkod (t.ex. "SE").
function isoToFlagTwemojiUrl(cc) {
  const code = String(cc || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const A = 0x1f1e6;
  const cp1 = A + (code.charCodeAt(0) - 65);
  const cp2 = A + (code.charCodeAt(1) - 65);
  const hex1 = cp1.toString(16);
  const hex2 = cp2.toString(16);
  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${hex1}-${hex2}.svg`;
}

function isoToCountryName(iso2, lang) {
  const code = String(iso2 || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;

  try {
    const locale =
      lang === "sv" ? "sv-SE" : lang === "en" ? "en-US" : lang === "es" ? "es-ES" : undefined;

    const dn = new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" });
    const name = dn.of(code);
    return typeof name === "string" ? name : code;
  } catch {
    return code;
  }
}


function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function antipodeLonLat(lon, lat) {
  let aLon = (Number(lon) || 0) + 180;
  // normalisera till [-180, 180]
  if (aLon > 180) aLon -= 360;
  if (aLon < -180) aLon += 360;
  const aLat = -(Number(lat) || 0);
  return [aLon, aLat];
}

// Server: SCORER_MAX_DISTANCE_KM = 17_000, SCORER_MAX_TIME_MS = 20_000
// Time curve: exp-normalized, k=3.2
const SCORER_MAX_TIME_MS = 20_000;
const SCORER_MAX_DISTANCE_KM = 17_000;
const TIME_K = 3.2;

function timePenaltyExp(tNorm, k) {
  // tNorm i [0,1]
  return Math.expm1(k * tNorm) / Math.expm1(k);
}

function scoreLocal(distanceKm, timeMs) {
  const distPenalty = Math.min(Number(distanceKm) / SCORER_MAX_DISTANCE_KM, 1);
  const tNorm = Math.min(Math.max(Number(timeMs) / SCORER_MAX_TIME_MS, 0), 1);
  const timePenalty = timePenaltyExp(tNorm, TIME_K);

  return distPenalty * 1000 + timePenalty * 1000;
}

// ---------- Progression UI helpers ----------
// --- Emoji helpers: render flag emojis as deterministic SVGs (Twemoji) ---
const TWEMOJI_SVG_BASE = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg";

function isRegionalIndicator(cp) {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

// Detect standard country flag emojis (two Regional Indicator symbols, e.g. 🇸🇪).
function isFlagEmoji(emoji) {
  if (!emoji) return false;
  const parts = Array.from(String(emoji).trim());
  if (parts.length !== 2) return false;
  const [a, b] = parts;
  const cp1 = a.codePointAt(0);
  const cp2 = b.codePointAt(0);
  return isRegionalIndicator(cp1) && isRegionalIndicator(cp2);
}

function flagEmojiToTwemojiUrl(emoji) {
  if (!isFlagEmoji(emoji)) return null;
  const parts = Array.from(String(emoji).trim());
  const hex = parts.map((ch) => ch.codePointAt(0).toString(16)).join("-");
  return `${TWEMOJI_SVG_BASE}/${hex}.svg`;
}

function FlagOrEmoji({ emoji, alt, className }) {
  const url = flagEmojiToTwemojiUrl(emoji);
  if (url) {
    return (
      <img
        className={className}
        src={url}
        alt={alt || ""}
        draggable="false"
        loading="lazy"
        style={{ width: "1em", height: "1em", verticalAlign: "-0.12em" }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return <>{emoji}</>;
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function safeArr(v) {
  return Array.isArray(v) ? v : [];
}
function numOr(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function normalizeBadge(b) {
  const o = safeObj(b);
  const code = o.code || o.badge_code || o.badgeCode || o.key;
  const name = o.name || o.badge_name || o.title || code;
  const emoji = o.emoji || "🏷️";
  const description = o.description || o.desc || "";
  const iconUrl = o.iconUrl || o.icon_url || null;
  return { code, name, emoji, description, iconUrl };
}
function normalizeDelta(d) {
  const o = safeObj(d);
  return {
    username: o.username,

    // Levels (legacy fields may exist in payloads)
    oldLevel: numOr(o.oldLevel ?? o.old_level, 0),
    newLevel: numOr(o.newLevel ?? o.new_level, 0),

    // Badges (existing UI)
    oldBadgesCount: numOr(o.oldBadgesCount ?? o.old_badges_count ?? o.badgesCountOld, 0),
    newBadgesCount: numOr(o.newBadgesCount ?? o.new_badges_count ?? o.badgesCountNew, 0),
    newBadges: safeArr(o.newBadges || o.new_badges)
      .map(normalizeBadge)
      .filter((x) => !!x.code),

    // XP (new)
    xpGained: numOr(o.xpGained ?? o.xp_gained ?? o.xpDelta ?? o.xp_delta, 0),
    xpMatch: numOr(o.xpMatch ?? o.xp_match, 0),
    xpWinBonus: numOr(o.xpWinBonus ?? o.xp_win_bonus ?? o.xpWin ?? o.xp_win, 0),
    xpBadges: numOr(o.xpBadges ?? o.xp_badges ?? o.badgeBonusXp ?? o.badge_bonus_xp, 0),

    oldXpTotal: numOr(o.oldXpTotal ?? o.old_xp_total, 0),
    newXpTotal: numOr(o.newXpTotal ?? o.new_xp_total, 0),

    xpIntoLevel: numOr(o.xpIntoLevel ?? o.xp_into_level, 0),
    xpToNext: numOr(o.xpToNext ?? o.xp_to_next, 0),
    xpPctToNext: numOr(o.xpPctToNext ?? o.xp_pct_to_next, 0),

    xpLevelBase: numOr(o.xpLevelBase ?? o.xp_level_base, 0),
    xpNextLevelAt: numOr(o.xpNextLevelAt ?? o.xp_next_level_at, 0),

    // Elo (new) - present only for rated 1v1 matches
    eloBefore: numOrNull(o.eloBefore ?? o.elo_before),
    eloAfter: numOrNull(o.eloAfter ?? o.elo_after),
    eloDelta: numOrNull(o.eloDelta ?? o.elo_delta),
  };
}

export default function Game({
  session,
  socket,
  match,
  gameState,
  onLogout,
  onLeaveMatch,
  // Trial practice (Login -> Prova)
  showReturnToLogin = false,
  onReturnToLogin,
  mapInvert, // (x,y) -> [lon,lat]
  mapProject, // (lon,lat) -> {x,y}
  onMapSize,
  debugShowTarget,
  onToggleDebugShowTarget,
}) {
  const { t, lang } = useI18n();
  const mapRef = useRef(null);
  const myName = session.username;

  // Practice = solo/övning
  const isPractice = !!match?.isPractice || !!match?.isSolo;

  // Guest-user (Login -> Prova) börjar med __guest...
  const isGuestUser = /^__guest/i.test(String(myName || ""));
  // I Prova-läge vill vi inte visa användarnamn i resultattabellens rubriker
  const hideNamesInResultTable = isPractice && isGuestUser;

  // Debug: endast för Toffaboffa i Öva-läge (practice/solo)
  const canUseDebug = isPractice && String(myName) === "Toffaboffa";

  // Stöd både "kontrollerad" debug via props och fallback lokalt state
  const [debugLocal, setDebugLocal] = useState(false);
  const effectiveDebugShowTarget =
    typeof debugShowTarget === "boolean" ? debugShowTarget : debugLocal;

  const toggleDebug =
    typeof onToggleDebugShowTarget === "function"
      ? onToggleDebugShowTarget
      : () => setDebugLocal((v) => !v);

  const debugEnabled = canUseDebug && effectiveDebugShowTarget;

  const opponentName = useMemo(() => {
    const players = Array.isArray(match?.players) ? match.players : [];
    return players.find((p) => p !== myName) || t("game.opponent");
  }, [match?.players, myName]);

  // --- map load gate ---
  const [mapLoaded, setMapLoaded] = useState(false);
  const [startReadySent, setStartReadySent] = useState(false);

  // --- click state ---
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [myClickPx, setMyClickPx] = useState(null); // {x,y}
  const [myLastClickLL, setMyLastClickLL] = useState(null); // {lon,lat,timeMs}
  const [myDistanceKm, setMyDistanceKm] = useState(null); // number

  // ✅ Visa min poäng direkt efter klick (innan round_result kommer)
  const [myPendingScore, setMyPendingScore] = useState(null); // number
  const [myPendingRoundIndex, setMyPendingRoundIndex] = useState(null); // number


  // ✅ Pop-poäng: kort visning efter klick (placerad nedtill, se CSS)
  const [clickPopScore, setClickPopScore] = useState(null); // number | null
  const clickPopHideRef = useRef(null);
  // I övning vill vi INTE visa bot/opp-markör
  const [oppClickPx, setOppClickPx] = useState(null); // {x,y}

  // --- pointer + lens ---
  const [pointer, setPointer] = useState({ x: 0, y: 0, inside: false });
  const rafRef = useRef(null);

  // ✅ Auto-submit när tiden går ut (förhindra dubbel-emits)
  const autoSubmittedRef = useRef(false);

  // ✅ Audio: unlock on user gesture + ping when first city appears
  const audioCtxRef = useRef(null);
  const firstCityPingPlayedRef = useRef(false);

  const ensureAudioUnlocked = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch (_) {}
  }, []);

  const playPing = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;

      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;

      if (ctx && ctx.state === "suspended") {
        // Best-effort; if the browser blocks it, we just stay silent.
        ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch (_) {}
  }, []);

  // Reset per match
  useEffect(() => {
    firstCityPingPlayedRef.current = false;
  }, [match?.matchId]);

  // Ping exactly once when the FIRST city of the match appears
  useEffect(() => {
    if (firstCityPingPlayedRef.current) return;
    if (gameState.currentRound !== 0) return;
    if (!gameState.city && !gameState.cityName) return;

    playPing();
    firstCityPingPlayedRef.current = true;
  }, [gameState.currentRound, gameState.city, gameState.cityName, playPing]);


  // ✅ Lens gate (Punkt 3)
  // Efter att du klickat: göm linsen tills 1s kvar på countdown, sedan får den synas igen.
  const [lensUnlocked, setLensUnlocked] = useState(false);

  // ✅ Lens toggle: initialt AV. Håll inne CTRL för att visa förstoringsglaset.
  // Släpper du CTRL försvinner det direkt.
  const [lensCtrlHeld, setLensCtrlHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Control") setLensCtrlHeld(true);
    };
    const onKeyUp = (e) => {
      if (e.key === "Control") setLensCtrlHeld(false);
    };
    const onBlur = () => setLensCtrlHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ✅ 1v1 fairness: visa target (och därmed ”rätt svar”) först när round_result kommit.
  // I practice/solo vill vi fortfarande kunna visa target direkt efter eget klick.
  const [roundResultReceived, setRoundResultReceived] = useState(false);

  // --- UI hover gate ---
  const [hoveringUi, setHoveringUi] = useState(false);
  const setHoveringUiSafe = useCallback((v) => {
    setHoveringUi(v);
    if (v) setPointer((p) => ({ ...p, inside: false }));
  }, []);

  // --- timer ---
  const [roundStartPerf, setRoundStartPerf] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  // --- ready / countdown ---
  const [showReadyButton, setShowReadyButton] = useState(false);
  const [iAmReady, setIAmReady] = useState(false);
  const [countdown, setCountdown] = useState(null);

  // -------- city meta ----------
  const cityNameRaw = gameState.cityName || gameState.city?.name || "";
  const cityLabel = shortCityName(cityNameRaw);
  const countryCode = gameState.city?.countryCode || null;
  const flagUrl = isoToFlagTwemojiUrl(countryCode);
  const isEasy = String(match?.difficulty || "").toLowerCase() === "easy";
  const countryName = isEasy ? isoToCountryName(countryCode, lang) : null;
  const pop = gameState.city?.population ? String(gameState.city.population) : null;

  const matchFinished = !!gameState.finalResult;
  const showStartGate = !matchFinished && gameState.currentRound < 0 && countdown === null;

  // ✅ Punkt 3: progress bar som visar rundans tid (20s)
  const showRoundTimeBar = !matchFinished && gameState.currentRound >= 0 && countdown === null && !showReadyButton;
  const roundTimePct = clamp((elapsedMs || 0) / SCORER_MAX_TIME_MS, 0, 1);

  // FIX: om hoveringUi fastnar
  useEffect(() => {
    if (!showReadyButton && !showStartGate && !matchFinished && countdown === null) {
      setHoveringUi(false);
    }
  }, [showReadyButton, showStartGate, matchFinished, countdown]);

  // -------- preload map image ----------
  useEffect(() => {
    setMapLoaded(false);
    try {
      const rootStyle = getComputedStyle(document.documentElement);
      const v = rootStyle.getPropertyValue("--map-image") || "";
      const m = v.match(/url\((['"]?)(.*?)\1\)/i);
      const url = m?.[2];
      if (!url) {
        setMapLoaded(true);
        return;
      }
      const img = new Image();
      img.onload = () => setMapLoaded(true);
      img.onerror = () => setMapLoaded(true);
      img.src = url;
    } catch {
      setMapLoaded(true);
    }
  }, []);

  // -------- reset per ny runda ----------
  useEffect(() => {
    setHasClickedThisRound(false);
    setMyClickPx(null);
    setMyLastClickLL(null);
    setMyDistanceKm(null);

    // ✅ Ny runda: vi har ännu inte fått round_result
    setRoundResultReceived(false);

    // ✅ reset live-score
    setMyPendingScore(null);
    setMyPendingRoundIndex(null);

    // ✅ Ny runda: nollställ pop-poäng
    if (clickPopHideRef.current) {
      clearTimeout(clickPopHideRef.current);
      clickPopHideRef.current = null;
    }
    setClickPopScore(null);

    // practice: se till att vi aldrig visar bot/opp-spår
    setOppClickPx(null);

    setShowReadyButton(false);
    setIAmReady(false);
    setCountdown(null);

    setElapsedMs(0);
    setRoundStartPerf(performance.now());
    setTimerRunning(gameState.currentRound >= 0);

    setHoveringUi(false);

    // ✅ Ny runda: linsen ska vara normal igen
    setLensUnlocked(false);


    // ✅ Ny runda: reset auto-submit gate
    autoSubmittedRef.current = false;
  }, [gameState.currentRound]);

  // -------- rapportera kartans storlek ----------
  useEffect(() => {
    if (!mapRef.current || !onMapSize) return;
    const el = mapRef.current;
    const report = () => {
      const rect = el.getBoundingClientRect();
      onMapSize({ width: rect.width, height: rect.height });
    };
    report();
    const ro = new ResizeObserver(() => report());
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMapSize]);

  // -------- timer loop ----------
  useEffect(() => {
    if (!timerRunning) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const start = roundStartPerf ?? now;
      setElapsedMs(now - start);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timerRunning, roundStartPerf]);

// ✅ Auto-klick när tiden tar slut (20s) om spelaren inte klickat
useEffect(() => {
  if (!timerRunning) return;
  if (hasClickedThisRound) return;
    if (autoSubmittedRef.current) return;
  if (!socket || !match) return;
  if (gameState.currentRound < 0) return;
  if (showReadyButton || countdown !== null) return;

  if (elapsedMs < SCORER_MAX_TIME_MS) return;
  if (autoSubmittedRef.current) return;
  autoSubmittedRef.current = true;

  const c = gameState.city;
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;

  // Antipod => ~maxdistans => 2000p när time=20s
  const [lon, lat] = antipodeLonLat(c.lon, c.lat);
  const timeMs = SCORER_MAX_TIME_MS;

  setTimerRunning(false);
    autoSubmittedRef.current = true;

  const dKm = haversineKm(lat, lon, c.lat, c.lon);
  setMyDistanceKm(Number.isFinite(dKm) ? dKm : null);

  // ⚠️ Detta är bara UI-feedback. Servern är fortfarande “source of truth”.
  setMyPendingScore(scoreLocal(dKm, timeMs));
  setMyPendingRoundIndex(gameState.currentRound);

  // Visa “mitt klick” på kartan om vi kan projicera
  if (mapProject) {
    try {
      const px = mapProject(lon, lat);
      if (px) setMyClickPx(px);
    } catch (_) {}
  }

  setMyLastClickLL({ lon, lat, timeMs });
  setHasClickedThisRound(true);

  // ✅ Direkt efter klick: göm linsen tills sista sekunden innan nästa stad
  setLensUnlocked(false);

  socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });
}, [
  elapsedMs,
  timerRunning,
  hasClickedThisRound,
  socket,
  match,
  gameState.currentRound,
  gameState.city,
  showReadyButton,
  countdown,
  mapProject,
]);

  // -------- score ----------
  const myScoreSoFar = useMemo(() => {
    let total = 0;
    for (const r of gameState.roundResults) {
      const res = r?.results?.[myName];
      if (res && Number.isFinite(res.score)) total += res.score;
    }
    return total;
  }, [gameState.roundResults, myName]);

  const oppScoreSoFar = useMemo(() => {
    let total = 0;
    for (const r of gameState.roundResults) {
      const res = r?.results?.[opponentName];
      if (res && Number.isFinite(res.score)) total += res.score;
    }
    return total;
  }, [gameState.roundResults, opponentName]);

  // ✅ Undvik dubbelräkning om serverresultatet redan finns för aktuell runda
  const hasOfficialResultThisRound = useMemo(() => {
    return (gameState.roundResults || []).some((r) => {
      if (r?.roundIndex !== gameState.currentRound) return false;
      const res = r?.results?.[myName];
      return !!(res && Number.isFinite(res.score));
    });
  }, [gameState.roundResults, gameState.currentRound, myName]);

  const myScoreLive = useMemo(() => {
    const pendingOk =
      !hasOfficialResultThisRound &&
      myPendingRoundIndex === gameState.currentRound &&
      Number.isFinite(myPendingScore);
    return myScoreSoFar + (pendingOk ? myPendingScore : 0);
  }, [
    myScoreSoFar,
    myPendingScore,
    myPendingRoundIndex,
    hasOfficialResultThisRound,
    gameState.currentRound,
  ]);

  // -------- HUD: rundrader ----------
  const hudRoundsFor = useCallback(
    (username, revealValues = true) => {
      const rows = Array.isArray(gameState.roundResults) ? gameState.roundResults : [];
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const rr = rows[i];
        const res = rr?.results?.[username] || null;

        // Om vi inte ska avslöja (t.ex. motståndare innan matchslut): visa bara radrubriken
        if (!revealValues) {
          out.push({
            idx: i + 1,
            distance: "—",
            time: "—",
            score: "—",
          });
          continue;
        }

        if (!res) continue;

        const distanceKm = Number.isFinite(res.distanceKm) ? res.distanceKm : null;
        const timeMs = Number.isFinite(res.timeMs) ? res.timeMs : null;
        const score = Number.isFinite(res.score) ? res.score : null;

        out.push({
          idx: i + 1,
          distance: fmtKmCompact(distanceKm),
          time: fmtSecFromMs(timeMs),
          score: fmtScore(score),
        });
      }

      // Om vi redan filtrerat bort null-res, vill vi fortfarande numrera konsekvent (1..N),
      // så vi behåller idx från runda i+1.
      return out;
    },
    [gameState.roundResults]
  );

  const myHudRounds = useMemo(() => hudRoundsFor(myName, true), [hudRoundsFor, myName]);
  const oppHudRounds = useMemo(() => hudRoundsFor(opponentName, true), [
    hudRoundsFor,
    opponentName,
  ]);

  // -------- target px ----------
  const targetPx = useMemo(() => {
    const c = gameState.city;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    if (!mapProject) return null;
    return mapProject(c.lon, c.lat);
  }, [gameState.city, mapProject]);

  const shouldShowTarget = useMemo(() => {
    // practice: visa target när DU klickat (eller debug)
    if (isPractice) return !!hasClickedThisRound || !!debugEnabled;

    // multiplayer: visa target först när servern skickat round_result (eller debug)
    return !!roundResultReceived || !!debugEnabled;
  }, [hasClickedThisRound, debugEnabled, isPractice, roundResultReceived]);


// Punkt 6 (justering): Låt facit-markern använda exakt StartPings-animationen.
// Vi "respawnar" samma ping vid samma position genom att remounta den med en ny key.
const TARGET_PING_LIFE_MS = 2100;
const [targetPingTick, setTargetPingTick] = useState(0);

useEffect(() => {
  if (!shouldShowTarget) {
    setTargetPingTick(0);
    return;
  }
  // Starta en ny ping direkt och därefter en ny när livet tar slut.
  setTargetPingTick((v) => v + 1);
  const id = setInterval(() => setTargetPingTick((v) => v + 1), TARGET_PING_LIFE_MS);
  return () => clearInterval(id);
}, [shouldShowTarget, gameState.currentRound]);

  // -------- socket events ----------
  useEffect(() => {
    if (!socket) return;

    const onStartReadyPrompt = () => setStartReadySent(false);

    const onRoundResult = ({ results }) => {
      setTimerRunning(false);

      // ✅ Nu är rundan ”officiellt” avgjord på servern
      setRoundResultReceived(true);

      // ✅ Vi har fått serverns resultat för rundan – släpp preliminär score
      setMyPendingScore(null);
      setMyPendingRoundIndex(null);

      // practice: ignorera motståndarens klick helt
      if (!isPractice) {
        try {
          const oppRes = results?.[opponentName];
          if (oppRes && mapProject && Number.isFinite(oppRes.lon) && Number.isFinite(oppRes.lat)) {
            const px = mapProject(oppRes.lon, oppRes.lat);
            if (px) setOppClickPx(px);
          }
        } catch (_) {}
      } else {
        setOppClickPx(null);
      }

      // endast multiplayer: visa “Redo för nästa”
      if (!isPractice) {
        setTimeout(() => setShowReadyButton(true), 2000);
      }
    };

    const onNextRoundCountdown = ({ seconds }) => {
      setHoveringUi(false);
      setShowReadyButton(false);
      setIAmReady(false);

      // ✅ Ny nedräkning: lås linsen igen (den låses upp när 1s kvar)
      setLensUnlocked(false);

      setCountdown(seconds);
      let left = seconds;
      const t = setInterval(() => {
        left -= 1;
        setCountdown(left);

        // ✅ Lås upp när det är 1 sekund kvar (och behåll upplåst fram till ny runda)
        if (left <= 1 && left > 0) {
          setLensUnlocked(true);
        }
        if (left <= 0) {
          // När nästa runda precis ska börja: låt den gärna fortsätta vara upplåst.
          setLensUnlocked(true);

          clearInterval(t);
          setCountdown(null);
        }
      }, 1000);
    };

    socket.on("start_ready_prompt", onStartReadyPrompt);
    socket.on("round_result", onRoundResult);
    socket.on("next_round_countdown", onNextRoundCountdown);

    return () => {
      socket.off("start_ready_prompt", onStartReadyPrompt);
      socket.off("round_result", onRoundResult);
      socket.off("next_round_countdown", onNextRoundCountdown);
    };
  }, [socket, opponentName, mapProject, isPractice]);

  // -------- pointer / lens ----------
  const onPointerMove = (e) => {
    if (hoveringUi) return;
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setPointer({ x, y, inside: true }));
  };

  const onPointerLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPointer((p) => ({ ...p, inside: false }));
  };

  // -------- click ----------
  const onMapClick = (e) => {
    if (!socket || !match) return;
    if (hasClickedThisRound) return;
    if (!mapRef.current) return;
    if (hoveringUi) return;
    if (showReadyButton || countdown !== null) return;
    if (gameState.currentRound < 0) return;

    if (!mapInvert) {
      alert(t("game.mapNotCalibrated"));
      return;
    }

    const rect = mapRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;

    const ll = mapInvert(xPx, yPx);
    if (!ll || !Array.isArray(ll) || ll.length !== 2) return;
    const [lon, lat] = ll;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    setTimerRunning(false);
    const timeMs = elapsedMs;

    const c = gameState.city;

    // ✅ Räkna min dist + preliminär score direkt (snabb HUD-feedback)
    let dKm = null;
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
      dKm = haversineKm(lat, lon, c.lat, c.lon);
    }
    setMyDistanceKm(Number.isFinite(dKm) ? dKm : null);

    // ⚠️ Detta är bara UI-feedback. Servern är fortfarande “source of truth”.
    if (Number.isFinite(dKm)) {
      setMyPendingScore(scoreLocal(dKm, timeMs));
      setMyPendingRoundIndex(gameState.currentRound);

      // ✅ Pop-poäng: visa direkt efter klick (endast UI)
      const popScore = Math.round(scoreLocal(dKm, timeMs));
      setClickPopScore(popScore);
      if (clickPopHideRef.current) clearTimeout(clickPopHideRef.current);
      clickPopHideRef.current = setTimeout(() => {
        setClickPopScore(null);
        clickPopHideRef.current = null;
      }, 3000);
    } else {
      setMyPendingScore(null);
      setMyPendingRoundIndex(null);

      // ✅ Pop-poäng: inget att visa utan dist
      setClickPopScore(null);
    }

    socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });
    setHasClickedThisRound(true);

    // ✅ Direkt efter klick: göm linsen tills sista sekunden innan nästa stad
    setLensUnlocked(false);

    setMyClickPx({ x: xPx, y: yPx });
    setMyLastClickLL({ lon, lat, timeMs });
  };

  // -------- lens style ----------
  const lensStyle = useMemo(() => {
    if (hoveringUi) return null;
    if (!pointer.inside || !mapRef.current) return null;

    // ✅ Toggle: visa bara när CTRL hålls nere.
    if (!lensCtrlHeld) return null;

    // ✅ Punkt 3: efter klick -> ingen lins förrän vi låst upp (1s kvar på countdown)
    if (hasClickedThisRound && !lensUnlocked) return null;

    const rect = mapRef.current.getBoundingClientRect();
    const zoom = 3;
    const bgSizeX = rect.width * zoom;
    const bgSizeY = rect.height * zoom;
    const bgPosX = -(pointer.x * zoom - 80);
    const bgPosY = -(pointer.y * zoom - 80);
    return {
      left: pointer.x,
      top: pointer.y,
      backgroundSize: `${bgSizeX}px ${bgSizeY}px`,
      backgroundPosition: `${bgPosX}px ${bgPosY}px`,
    };
  }, [pointer, hoveringUi, hasClickedThisRound, lensUnlocked, lensCtrlHeld]);

  // -------- button helpers ----------
  const stop = (fn) => (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    fn?.(e);
  };

  const onPressReady = () => {
    if (!socket || !match) return;
    if (iAmReady) return;
    setIAmReady(true);
    socket.emit("player_ready", { matchId: match.matchId, roundIndex: gameState.currentRound });
  };

  const onPressStartReady = () => {
    if (!socket || !match) return;
    if (startReadySent) return;

    // ✅ Unlock audio on user gesture so the first-city ping can play
    ensureAudioUnlocked();
    setStartReadySent(true);
    socket.emit("player_start_ready", { matchId: match.matchId });
  };

  // -------- Resultattabelldata (för finish overlay) ----------
  const roundsTable = useMemo(() => {
    const rows = Array.isArray(gameState.roundResults) ? gameState.roundResults : [];

    const mapped = rows.map((rr, i) => {
      const city = rr?.city || null;
	const cityLabel = shortCityName(
	  city?.name || rr?.cityName || t("game.roundN", { n: i + 1 })
	);

      const myRes = rr?.results?.[myName] || null;
      const oppRes = rr?.results?.[opponentName] || null;

      const myScore = Number.isFinite(myRes?.score) ? myRes.score : null;
      const oppScore = Number.isFinite(oppRes?.score) ? oppRes.score : null;

      let myWon = false;
      let oppWon = false;
      if (!isPractice && Number.isFinite(myScore) && Number.isFinite(oppScore)) {
        if (myScore < oppScore) myWon = true;
        else if (oppScore < myScore) oppWon = true;
      }

      return {
        key: `${i}-${cityLabel}`,
        idx: i + 1,
        cityLabel,
        my: {
          score: myScore,
          distanceKm: Number.isFinite(myRes?.distanceKm) ? myRes.distanceKm : null,
          timeMs: Number.isFinite(myRes?.timeMs) ? myRes.timeMs : null,
          won: myWon,
        },
        opp: {
          score: oppScore,
          distanceKm: Number.isFinite(oppRes?.distanceKm) ? oppRes.distanceKm : null,
          timeMs: Number.isFinite(oppRes?.timeMs) ? oppRes.timeMs : null,
          won: oppWon,
        },
      };
    });

    const totals = {
      myScore: mapped.reduce((a, r) => a + (Number.isFinite(r.my.score) ? r.my.score : 0), 0),
      oppScore: mapped.reduce((a, r) => a + (Number.isFinite(r.opp.score) ? r.opp.score : 0), 0),
    };

    return { rows: mapped, totals };
  }, [gameState.roundResults, myName, opponentName, isPractice]);

  // -------- Progression delta (finish overlay) ----------
  const progression = useMemo(() => {
    const final = safeObj(gameState.finalResult);
    const pd = safeObj(final.progressionDelta);
    const myDeltaRaw = pd?.[myName];
    const oppDeltaRaw = pd?.[opponentName];

    const myDelta = myDeltaRaw ? normalizeDelta(myDeltaRaw) : null;
    const oppDelta = oppDeltaRaw ? normalizeDelta(oppDeltaRaw) : null;

    const myLevelUp = !!myDelta && myDelta.newLevel > myDelta.oldLevel;
    const oppLevelUp = !!oppDelta && oppDelta.newLevel > oppDelta.oldLevel;

    const myNewBadges = myDelta?.newBadges || [];
    const oppNewBadges = oppDelta?.newBadges || [];

    const myBadgesCountUp = !!myDelta && myDelta.newBadgesCount > myDelta.oldBadgesCount;
    const oppBadgesCountUp = !!oppDelta && oppDelta.newBadgesCount > oppDelta.oldBadgesCount;

    const myXpGained = numOr(myDelta?.xpGained, 0);
    const oppXpGained = numOr(oppDelta?.xpGained, 0);
    const myBadgeXp = numOr(myDelta?.xpBadges, 0);
    const oppBadgeXp = numOr(oppDelta?.xpBadges, 0);
    const hasXp = myXpGained > 0 || oppXpGained > 0;

    return {
      myDelta,
      oppDelta,
      myLevelUp,
      oppLevelUp,
      myNewBadges,
      oppNewBadges,
      myXpGained,
      oppXpGained,
      myBadgeXp,
      oppBadgeXp,
      hasXp,
      hasAnything:
        myNewBadges.length > 0 ||
        oppNewBadges.length > 0 ||
        myLevelUp ||
        oppLevelUp ||
        myBadgesCountUp ||
        oppBadgesCountUp ||
        hasXp,
    };
  }, [gameState.finalResult, myName, opponentName]);

  return (
    <div className="game-root">
      <div
        className={`world-map-full ${debugEnabled ? "is-debug" : ""}`}
        ref={mapRef}
        onClick={onMapClick}
        onMouseMove={onPointerMove}
        onMouseLeave={onPointerLeave}
        // title bortplockad: “Klicka på kartan…” behövs inte
      >
        {/* Score + rundrader */}
        <div className="hud hud-left">
          <div className="hud-name">{isPractice ? `${myName} (${t("common.modes.practice")})` : myName}</div>
          <div className="hud-score-line">
            <div className="hud-score-label">{t("game.currentTotalScore")}</div>
            <div className="hud-score">{Math.round(myScoreLive)}</div>
          </div>

          {myHudRounds.length > 0 && (
            <div className="hud-rounds">
              {myHudRounds.map((r) => (
                <div key={`me-${r.idx}`} className="hud-round">
                  <span className="hud-round-idx">{r.idx}</span>
                  <span className="hud-round-dist">{r.distance}</span>
                  <span className="hud-round-time">{r.time}</span>
                  <span className="hud-round-score">{r.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inget motståndar-HUD i Öva */}
        {!isPractice && (
          <div className="hud hud-right">
            <div className="hud-name">{opponentName}</div>
            <div className="hud-score-line">
              <div className="hud-score-label">{t("game.currentTotalScore")}</div>
              <div className="hud-score">{Math.round(oppScoreSoFar)}</div>
            </div>

            {oppHudRounds.length > 0 && (
              <div className="hud-rounds">
                {oppHudRounds.map((r) => (
                  <div key={`opp-${r.idx}`} className="hud-round">
                    <span className="hud-round-idx">{r.idx}</span>
                    <span className="hud-round-dist">{r.distance}</span>
                    <span className="hud-round-time">{r.time}</span>
                    <span className="hud-round-score">{r.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div
          className="hud-actions"
          onMouseEnter={() => setHoveringUiSafe(true)}
          onMouseLeave={() => setHoveringUiSafe(false)}
        >
          {canUseDebug && (

          <button className="hud-btn" onClick={stop(toggleDebug)}>
            {debugEnabled ? t("game.debugOn") : t("game.debug")}
          </button>
          )}
<button className="hud-btn" onClick={stop(onLeaveMatch)}>{t("common.leave")}</button>
          <button className="hud-btn" onClick={stop(onLogout)}>
            {t("common.logout")}
          </button>
        </div>

        {/* Bottom strip */}
        <div className="city-bottom">
          {Number.isFinite(clickPopScore) && (
            <div className="click-pop-score">{Math.round(clickPopScore)}</div>
          )}
          <div className="city-bar">
<div className="city-label">
  <span className="city-label-row">
    <span className="city-name">{cityLabel || "…"}</span>
    {flagUrl ? (
      <img
        className="city-flag-img"
        src={flagUrl}
        alt={countryCode ? `Flagga ${countryCode}` : "Flagga"}
        title={countryCode || ""}
        draggable={false}
      />
    ) : null}
  </span>

  {/* Enkel: visa även land */}
  {countryName ? <span className="city-country">{countryName}</span> : null}
</div>
            {pop ? <div className="city-pop">{t("game.pop")}: {pop}</div> : null}
            <div className="city-timer">{fmtMs(elapsedMs)}s</div>
            {countdown !== null && countdown > 0 && (
              <div className="city-countdown">{t("game.nextRoundIn")} {countdown}s</div>
            )}
            {showRoundTimeBar && (
              <div className="round-timebar-wrap">
                <div className="round-timebar">
                  <div
                    className="round-timebar-fill"
                    style={{ width: `${Math.round(roundTimePct * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Crosshair */}
        <div
          className="crosshair"
          style={{
            left: pointer.x,
            top: pointer.y,
            opacity: pointer.inside && !hoveringUi ? 1 : 0,
          }}
        />

        {/* Lens */}
        {lensStyle && <div className="lens" style={lensStyle} />}

        {/* Target marker */}
        {shouldShowTarget && targetPx && (
          <div
            key={`targetping_${gameState.currentRound ?? 0}_${targetPingTick}`}
            className="start-ping target-marker target-green"
            style={{
              "--ping-life": `${TARGET_PING_LIFE_MS}ms`,
              left: targetPx.x,
              top: targetPx.y,
              width: "18px",
              height: "18px",
            }}
          >
            <span className="ping-core" />
            <span className="ping-ring ring1" />
            <span className="ping-ring ring2" />
            <span className="ping-ring ring3" />
          </div>
        )}
        {/* Click markers (endast din i Öva) */}
        {myClickPx && (
          <>
            <div
              className="click-marker click-marker-me"
              style={{ left: myClickPx.x, top: myClickPx.y }}
              title={
                myLastClickLL
                  ? `Du: lon ${myLastClickLL.lon.toFixed(3)}, lat ${myLastClickLL.lat.toFixed(
                      3
                    )} (${fmtMs(myLastClickLL.timeMs)}s)`
                  : "Du"
              }
            />
            {Number.isFinite(myDistanceKm) && (
              <div className="click-distance" style={{ left: myClickPx.x, top: myClickPx.y + 16 }}>
                {Math.round(myDistanceKm)} km
              </div>
            )}
          </>
        )}

        {/* Ingen opp-marker i Öva */}
        {!isPractice && oppClickPx && (
          <div
            className="click-marker click-marker-opp"
            style={{ left: oppClickPx.x, top: oppClickPx.y }}
          />
        )}

        {/* Debug target + debug click */}
        {debugEnabled && targetPx && (
          <div
            className="debug-dot debug-dot-target"
            style={{ left: targetPx.x, top: targetPx.y }}
          />
        )}
        {debugEnabled && myClickPx && (
          <div
            className="debug-dot debug-dot-click"
            style={{ left: myClickPx.x, top: myClickPx.y }}
          />
        )}

        {/* Ready overlay (endast multiplayer) */}
        {showReadyButton && !matchFinished && !isPractice && (
          <div
            className="ready-overlay"
            onMouseEnter={() => setHoveringUiSafe(true)}
            onMouseLeave={() => setHoveringUiSafe(false)}
          >
            <button className="ready-btn" onClick={stop(onPressReady)} disabled={iAmReady}>
              {iAmReady ? t("game.waitingForOthers") : t("game.readyForNext")}
            </button>
          </div>
        )}

        {/* Start gate overlay */}
        {showStartGate && (
          <div
            className="ready-overlay"
            onMouseEnter={() => setHoveringUiSafe(true)}
            onMouseLeave={() => setHoveringUiSafe(false)}
          >
            <div className="ready-stack">
              <button
                className="ready-btn"
                onClick={stop(onPressStartReady)}
                disabled={!mapLoaded || startReadySent}
              >
                {!mapLoaded ? t("game.loadingMap") : startReadySent ? t("game.waiting") : t("game.ready")}
              </button>

              {/* Small helper shown only before you press "Ready" */}
              {mapLoaded && !startReadySent && (
                <div className="ready-hint">{t("game.ctrlMagnifierHint")}</div>
              )}
            </div>
          </div>
        )}

        {/* Finish overlay + Resultattabell */}
        {matchFinished && (
          <div
            className="finish-overlay"
            onMouseEnter={() => setHoveringUiSafe(true)}
            onMouseLeave={() => setHoveringUiSafe(false)}
          >
            <div className="finish-card finish-card-wide">
              <div className="finish-title">{isPractice ? t("game.practiceFinished") : t("game.finalResults")}</div>

              <div className="finish-row">
                <span>{myName}</span>
                <span>{Math.round(myScoreSoFar)}</span>
              </div>

              {!isPractice && (
                <div className="finish-row">
                  <span>{opponentName}</span>
                  <span>{Math.round(oppScoreSoFar)}</span>
                </div>
              )}

              {!isPractice && (
                <div className="finish-winner">
                  {gameState.finalResult.winner === myName
                    ? "Du vann"
                    : gameState.finalResult.winner
                    ? t("game.youLost")
                    : "Oavgjort"}
                </div>
              )}

{/* XP (finish overlay) */}
{progression.myDelta &&
  (progression.myDelta.xpGained > 0 ||
    progression.myDelta.xpMatch > 0 ||
    progression.myDelta.xpWinBonus > 0 ||
    progression.myDelta.xpBadges > 0) && (
	    <div className="finish-xp">
	      <div className="finish-xp-grid">
	        <div className="finish-xp-label">{t("game.matchEnd.match")}</div>
	        <div className="finish-xp-val">
	          +{Math.round(progression.myDelta.xpMatch)} {t("common.xp")}
	        </div>

	        {progression.myDelta.xpWinBonus > 0 && (
	          <>
	            <div className="finish-xp-label">{t("game.matchEnd.win")}</div>
	            <div className="finish-xp-val">
	              +{Math.round(progression.myDelta.xpWinBonus)} {t("common.xp")}
	            </div>
	          </>
	        )}

	        {progression.myDelta.xpBadges > 0 && (
	          <>
	            <div className="finish-xp-label">{t("game.matchEnd.badge")}</div>
	            <div className="finish-xp-val">
	              +{Math.round(progression.myDelta.xpBadges)} {t("common.xp")}
	            </div>
	          </>
	        )}

	        <div className="finish-xp-divider" />

	        <div className="finish-xp-label finish-xp-total">{t("game.matchEnd.total")}</div>
	        <div className="finish-xp-val finish-xp-total">
	          {Math.round(progression.myDelta.xpGained)} {t("common.xp")}
	        </div>
	      </div>

	      {isPractice && progression.myLevelUp ? (
	        <div className="finish-xp-sub">
	          <span className="level-up-chip">
	            ⬆️ {t("game.matchEnd.levelUp")} {progression.myDelta.oldLevel} →{" "}
	            {progression.myDelta.newLevel}
	          </span>
	        </div>
	      ) : null}
	    </div>
  )}


{/* ELO (finish overlay) */}
{!isPractice &&
  progression.myDelta &&
  progression.myDelta.eloDelta != null &&
  progression.myDelta.eloBefore != null &&
  progression.myDelta.eloAfter != null && (
    <div className="finish-xp">
      <div className="finish-xp-grid">
        <div className="finish-xp-label">ELO</div>
        <div className="finish-xp-val">
          {progression.myDelta.eloDelta >= 0 ? "+" : ""}
          {Math.round(progression.myDelta.eloDelta)}{" "}
          <span style={{ opacity: 0.85 }}>
            ({Math.round(progression.myDelta.eloBefore)} → {Math.round(progression.myDelta.eloAfter)})
          </span>
        </div>
      </div>
    </div>
  )}

{/* ✅ Progression: kompakt rad + ikonchips (som Lobby/Progression) */}
			{!isPractice && progression.hasAnything && (
			  <div className="finish-progression">
				{/* Jag */}
				{progression.myDelta && (
				  <div className="finish-prog-row">
					<div className="finish-prog-left">{myName}:</div>

					<div className="finish-prog-right">
					  {progression.myLevelUp ? (
						<span className="level-up-chip">
						  ⬆️ Level {progression.myDelta.oldLevel} → {progression.myDelta.newLevel}
						</span>
					  ) : null}

					  {progression.myNewBadges.length > 0 ? (
						<div className="finish-prog-icons">
						  {progression.myNewBadges.map((b) => {
							const emoji = b.emoji || "🏷️";
							const tooltipTitle = b.name || "";
							const tooltipDesc = b.description || "";

							return (
							  <span
								key={b.code}
								className="badge-emoji-only is-earned"
								aria-label={tooltipTitle}
								title=""
							  >
								<FlagOrEmoji emoji={emoji} alt={tooltipTitle} className="badge-flag" />

								{(tooltipTitle || tooltipDesc) && (
								  <span className="badge-tooltip" role="tooltip">
									<span className="badge-tooltip-title">{tooltipTitle}</span>
									<span className="badge-tooltip-desc">{tooltipDesc}</span>
								  </span>
								)}
							  </span>
							);
						  })}
						</div>
					  ) : (
						!progression.myLevelUp && <span className="finish-prog-dash">—</span>
					  )}
					</div>
				  </div>
				)}

				{/* Motståndare */}
				{progression.oppDelta && (
				  <div className="finish-prog-row">
					<div className="finish-prog-left">{opponentName}:</div>

					<div className="finish-prog-right">
					  {progression.oppLevelUp ? (
						<span className="level-up-chip">
						  ⬆️ Level {progression.oppDelta.oldLevel} → {progression.oppDelta.newLevel}
						</span>
					  ) : null}

					  {progression.oppNewBadges.length > 0 ? (
						<div className="finish-prog-icons">
						  {progression.oppNewBadges.map((b) => {
							const emoji = b.emoji || "🏷️";
							const tooltipTitle = b.name || "";
							const tooltipDesc = b.description || "";

							return (
							  <span
								key={b.code}
								className="badge-emoji-only is-earned"
								aria-label={tooltipTitle}
								title=""
							  >
								<FlagOrEmoji emoji={emoji} alt={tooltipTitle} className="badge-flag" />

								{(tooltipTitle || tooltipDesc) && (
								  <span className="badge-tooltip" role="tooltip">
									<span className="badge-tooltip-title">{tooltipTitle}</span>
									<span className="badge-tooltip-desc">{tooltipDesc}</span>
								  </span>
								)}
							  </span>
							);
						  })}
						</div>
					  ) : (
						!progression.oppLevelUp && <span className="finish-prog-dash">—</span>
					  )}
					</div>
				  </div>
				)}
			  </div>
			)}

              {/* ✅ Per-runda tabell */}
              <div className="rounds-table-wrap">
                <table className="rounds-table">
                  <thead>
                    <tr>
                      <th>R</th>
                      <th>{t("game.city")}</th>
                      <th>{t("game.table.scoreCol", { name: hideNamesInResultTable ? "" : myName }).trim()}</th>
                      <th>{t("game.table.distanceCol", { name: hideNamesInResultTable ? "" : myName }).trim()}</th>
                      <th>{t("game.table.timeCol", { name: hideNamesInResultTable ? "" : myName }).trim()}</th>
                      {!isPractice && (
                        <>
                          <th>{t("game.table.scoreCol", { name: opponentName })}</th>
                          <th>{t("game.table.distanceCol", { name: opponentName })}</th>
                          <th>{t("game.table.timeCol", { name: opponentName })}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {roundsTable.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="rt-round">{r.idx}</td>
                        <td className="rt-city">{r.cityLabel}</td>

                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>
                          {fmtScore(r.my.score)}
                        </td>
                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>
                          {fmtKm(r.my.distanceKm)}
                        </td>
                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>
                          {fmtSecFromMs(r.my.timeMs)}
                        </td>

                        {!isPractice && (
                          <>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>
                              {fmtScore(r.opp.score)}
                            </td>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>
                              {fmtKm(r.opp.distanceKm)}
                            </td>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>
                              {fmtSecFromMs(r.opp.timeMs)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}

                    {/* Total */}
                    <tr className="rt-total">
                      <td colSpan={2}>{t("game.total")}</td>
                      <td>{fmtScore(roundsTable.totals.myScore)}</td>
                      <td colSpan={2} />
                      {!isPractice && (
                        <>
                          <td>{fmtScore(roundsTable.totals.oppScore)}</td>
                          <td colSpan={2} />
                        </>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="finish-actions">
                {showReturnToLogin ? (
                  <button className="hud-btn" onClick={stop(onReturnToLogin || onLeaveMatch)}>
                    {t("game.backToLogin")}
                  </button>
                ) : (
                  <button className="hud-btn" onClick={stop(onLeaveMatch)}>
                    {t("game.backToLobby")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
