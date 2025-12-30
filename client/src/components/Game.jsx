// client/src/components/Game.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

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

// ---------- Progression UI helpers ----------
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
    oldLevel: numOr(o.oldLevel ?? o.old_level, 0),
    newLevel: numOr(o.newLevel ?? o.new_level, 0),
    oldBadgesCount: numOr(o.oldBadgesCount ?? o.old_badges_count ?? o.badgesCountOld, 0),
    newBadgesCount: numOr(o.newBadgesCount ?? o.new_badges_count ?? o.badgesCountNew, 0),
    newBadges: safeArr(o.newBadges || o.new_badges)
      .map(normalizeBadge)
      .filter((x) => !!x.code),
  };
}

export default function Game({
  session,
  socket,
  match,
  gameState,
  onLogout,
  onLeaveMatch,
  mapInvert, // (x,y) -> [lon,lat]
  mapProject, // (lon,lat) -> {x,y}
  onMapSize,
  debugShowTarget,
  onToggleDebugShowTarget,
}) {
  const mapRef = useRef(null);
  const myName = session.username;

  // Practice = solo/övning
  const isPractice = !!match?.isPractice || !!match?.isSolo;

  const opponentName = useMemo(() => {
    const players = Array.isArray(match?.players) ? match.players : [];
    return players.find((p) => p !== myName) || "Motståndare";
  }, [match?.players, myName]);

  // --- map load gate ---
  const [mapLoaded, setMapLoaded] = useState(false);
  const [startReadySent, setStartReadySent] = useState(false);

  // --- click state ---
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [myClickPx, setMyClickPx] = useState(null); // {x,y}
  const [myLastClickLL, setMyLastClickLL] = useState(null); // {lon,lat,timeMs}
  const [myDistanceKm, setMyDistanceKm] = useState(null); // number

  // I övning vill vi INTE visa bot/opp-markör
  const [oppClickPx, setOppClickPx] = useState(null); // {x,y}

  // --- pointer + lens ---
  const [pointer, setPointer] = useState({ x: 0, y: 0, inside: false });
  const rafRef = useRef(null);

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
  const pop = gameState.city?.population ? String(gameState.city.population) : null;

  const matchFinished = !!gameState.finalResult;
  const showStartGate = !matchFinished && gameState.currentRound < 0;

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

    // practice: se till att vi aldrig visar bot/opp-spår
    setOppClickPx(null);

    setShowReadyButton(false);
    setIAmReady(false);
    setCountdown(null);

    setElapsedMs(0);
    setRoundStartPerf(performance.now());
    setTimerRunning(gameState.currentRound >= 0);

    setHoveringUi(false);
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

  // -------- target px ----------
  const targetPx = useMemo(() => {
    const c = gameState.city;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    if (!mapProject) return null;
    return mapProject(c.lon, c.lat);
  }, [gameState.city, mapProject]);

  const shouldShowTarget = useMemo(() => {
    // practice: visa bara target när DU klickat (eller debug)
    return !!hasClickedThisRound || (!!oppClickPx && !isPractice) || !!debugShowTarget;
  }, [hasClickedThisRound, oppClickPx, debugShowTarget, isPractice]);

  // -------- socket events ----------
  useEffect(() => {
    if (!socket) return;

    const onStartReadyPrompt = () => setStartReadySent(false);

    const onRoundResult = ({ results }) => {
      setTimerRunning(false);

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
        setTimeout(() => setShowReadyButton(true), 3500);
      }
    };

    const onNextRoundCountdown = ({ seconds }) => {
      setHoveringUi(false);
      setShowReadyButton(false);
      setIAmReady(false);

      setCountdown(seconds);
      let left = seconds;
      const t = setInterval(() => {
        left -= 1;
        setCountdown(left);
        if (left <= 0) {
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
      alert("Kartan är inte kalibrerad än (mapInvert saknas).");
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
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
      setMyDistanceKm(haversineKm(lat, lon, c.lat, c.lon));
    } else {
      setMyDistanceKm(null);
    }

    socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });
    setHasClickedThisRound(true);
    setMyClickPx({ x: xPx, y: yPx });
    setMyLastClickLL({ lon, lat, timeMs });
  };

  // -------- lens style ----------
  const lensStyle = useMemo(() => {
    if (hoveringUi) return null;
    if (!pointer.inside || !mapRef.current) return null;
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
  }, [pointer, hoveringUi]);

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
    setStartReadySent(true);
    socket.emit("player_start_ready", { matchId: match.matchId });
  };

  // -------- Resultattabelldata (för finish overlay) ----------
  const roundsTable = useMemo(() => {
    const rows = Array.isArray(gameState.roundResults) ? gameState.roundResults : [];

    const mapped = rows.map((rr, i) => {
      const city = rr?.city || null;
      const cityLabel = shortCityName(city?.name || rr?.cityName || `Runda ${i + 1}`);

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

    return {
      myDelta,
      oppDelta,
      myLevelUp,
      oppLevelUp,
      myNewBadges,
      oppNewBadges,
      hasAnything:
        myNewBadges.length > 0 ||
        oppNewBadges.length > 0 ||
        myLevelUp ||
        oppLevelUp ||
        myBadgesCountUp ||
        oppBadgesCountUp,
    };
  }, [gameState.finalResult, myName, opponentName]);

  return (
    <div className="game-root">
      <div
        className={`world-map-full ${debugShowTarget ? "is-debug" : ""}`}
        ref={mapRef}
        onClick={onMapClick}
        onMouseMove={onPointerMove}
        onMouseLeave={onPointerLeave}
        title="Klicka där du tror att staden ligger"
      >
        {/* Score */}
        <div className="hud hud-left">
          <div className="hud-name">{isPractice ? `${myName} (Öva)` : myName}</div>
          <div className="hud-score">{Math.round(myScoreSoFar)}</div>
        </div>

        {/* Inget motståndar-HUD i Öva */}
        {!isPractice && (
          <div className="hud hud-right">
            <div className="hud-name">{opponentName}</div>
            <div className="hud-score">{matchFinished ? Math.round(oppScoreSoFar) : "—"}</div>
          </div>
        )}

        {/* Actions */}
        <div
          className="hud-actions"
          onMouseEnter={() => setHoveringUiSafe(true)}
          onMouseLeave={() => setHoveringUiSafe(false)}
        >
          <button className="hud-btn" onClick={stop(onToggleDebugShowTarget)}>
            {debugShowTarget ? "Debug: ON" : "Debug"}
          </button>
          <button className="hud-btn" onClick={stop(onLeaveMatch)}>
            Lämna
          </button>
          <button className="hud-btn" onClick={stop(onLogout)}>
            Logga ut
          </button>
        </div>

        {/* Bottom strip */}
        <div className="city-bottom">
          <div className="city-bar">
            <div className="city-label">
              {cityLabel || "…"}
              {flagUrl ? (
                <img
                  className="city-flag-img"
                  src={flagUrl}
                  alt={countryCode ? `Flagga ${countryCode}` : "Flagga"}
                  title={countryCode || ""}
                  draggable={false}
                />
              ) : null}
            </div>
            {pop ? <div className="city-pop">Pop: {pop}</div> : null}
            <div className="city-timer">{fmtMs(elapsedMs)}s</div>
            {countdown !== null && countdown > 0 && (
              <div className="city-countdown">Nästa runda om {countdown}s</div>
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
          <div className="target-marker" style={{ left: targetPx.x, top: targetPx.y }} />
        )}

        {/* Click markers (endast din i Öva) */}
        {myClickPx && (
          <>
            <div
              className="click-marker click-marker-me"
              style={{ left: myClickPx.x, top: myClickPx.y }}
              title={
                myLastClickLL
                  ? `Du: lon ${myLastClickLL.lon.toFixed(3)}, lat ${myLastClickLL.lat.toFixed(3)} (${fmtMs(
                      myLastClickLL.timeMs
                    )}s)`
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
          <div className="click-marker click-marker-opp" style={{ left: oppClickPx.x, top: oppClickPx.y }} />
        )}

        {/* Debug target + debug click */}
        {debugShowTarget && targetPx && (
          <div className="debug-dot debug-dot-target" style={{ left: targetPx.x, top: targetPx.y }} />
        )}
        {debugShowTarget && myClickPx && (
          <div className="debug-dot debug-dot-click" style={{ left: myClickPx.x, top: myClickPx.y }} />
        )}

        {/* Ready overlay (endast multiplayer) */}
        {showReadyButton && !matchFinished && !isPractice && (
          <div
            className="ready-overlay"
            onMouseEnter={() => setHoveringUiSafe(true)}
            onMouseLeave={() => setHoveringUiSafe(false)}
          >
            <button className="ready-btn" onClick={stop(onPressReady)} disabled={iAmReady}>
              {iAmReady ? "Väntar på andra..." : "Redo för nästa"}
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
            <button className="ready-btn" onClick={stop(onPressStartReady)} disabled={!mapLoaded || startReadySent}>
              {!mapLoaded ? "Laddar karta..." : startReadySent ? "Väntar..." : "Redo"}
            </button>
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
              <div className="finish-title">{isPractice ? "Övning klar" : "Slutresultat"}</div>

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
                    ? "Du förlorade"
                    : "Oavgjort"}
                </div>
              )}

              {/* ✅ Progression: badges + level up (endast riktiga matcher) */}
              {!isPractice && progression.hasAnything && (
                <div className="finish-progression">
                  {/* Jag */}
                  {progression.myDelta && (
                    <div className="finish-prog-block">
                      <div className="finish-prog-title">
                        {myName}
                        {progression.myLevelUp ? (
                          <span className="level-up-chip">
                            ⬆️ Level {progression.myDelta.oldLevel} → {progression.myDelta.newLevel}
                          </span>
                        ) : null}
                      </div>

                      {progression.myNewBadges.length > 0 ? (
                        <div className="finish-badges">
                          {progression.myNewBadges.map((b) => (
                            <div key={b.code} className="badge-pill" title={b.description || ""}>
                              <span className="badge-emoji">{b.emoji || "🏷️"}</span>
                              <span className="badge-name">{b.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="finish-prog-muted">Inga nya badges.</div>
                      )}
                    </div>
                  )}

                  {/* Motståndare */}
                  {progression.oppDelta && (
                    <div className="finish-prog-block">
                      <div className="finish-prog-title">
                        {opponentName}
                        {progression.oppLevelUp ? (
                          <span className="level-up-chip">
                            ⬆️ Level {progression.oppDelta.oldLevel} → {progression.oppDelta.newLevel}
                          </span>
                        ) : null}
                      </div>

                      {progression.oppNewBadges.length > 0 ? (
                        <div className="finish-badges">
                          {progression.oppNewBadges.map((b) => (
                            <div key={b.code} className="badge-pill" title={b.description || ""}>
                              <span className="badge-emoji">{b.emoji || "🏷️"}</span>
                              <span className="badge-name">{b.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="finish-prog-muted">Inga nya badges.</div>
                      )}
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
                      <th>Stad</th>
                      <th>{myName} poäng</th>
                      <th>{myName} avstånd</th>
                      <th>{myName} tid</th>
                      {!isPractice && (
                        <>
                          <th>{opponentName} poäng</th>
                          <th>{opponentName} avstånd</th>
                          <th>{opponentName} tid</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {roundsTable.rows.map((r) => (
                      <tr key={r.key}>
                        <td className="rt-round">{r.idx}</td>
                        <td className="rt-city">{r.cityLabel}</td>

                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>{fmtScore(r.my.score)}</td>
                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>{fmtKm(r.my.distanceKm)}</td>
                        <td className={`rt-cell ${r.my.won ? "rt-win" : ""}`}>{fmtSecFromMs(r.my.timeMs)}</td>

                        {!isPractice && (
                          <>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>{fmtScore(r.opp.score)}</td>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>{fmtKm(r.opp.distanceKm)}</td>
                            <td className={`rt-cell ${r.opp.won ? "rt-win" : ""}`}>{fmtSecFromMs(r.opp.timeMs)}</td>
                          </>
                        )}
                      </tr>
                    ))}

                    {/* Total */}
                    <tr className="rt-total">
                      <td colSpan={2}>Total</td>
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
                <button className="hud-btn" onClick={stop(onLeaveMatch)}>
                  Till lobby
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
