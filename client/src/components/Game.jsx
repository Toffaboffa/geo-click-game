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
function isoToFlagEmoji(cc) {
  const code = String(cc || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + (code.charCodeAt(0) - 65),
    A + (code.charCodeAt(1) - 65)
  );
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

  const opponentName = useMemo(() => {
    return match.players.find((p) => p !== myName) || "Motståndare";
  }, [match.players, myName]);

  // --- map load gate ---
  const [mapLoaded, setMapLoaded] = useState(false);
  const [startReadySent, setStartReadySent] = useState(false);

  // --- click state ---
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [myClickPx, setMyClickPx] = useState(null); // {x,y}
  const [myLastClickLL, setMyLastClickLL] = useState(null); // {lon,lat,timeMs}
  const [myDistanceKm, setMyDistanceKm] = useState(null); // number
  const [oppClickPx, setOppClickPx] = useState(null); // {x,y}

  // --- pointer + lens ---
  const [pointer, setPointer] = useState({ x: 0, y: 0, inside: false });
  const rafRef = useRef(null);

  // --- UI hover gate (NYTT): dölj lens/crosshair när musen är på knappar ---
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
  const flag = isoToFlagEmoji(gameState.city?.countryCode);
  const pop = gameState.city?.population ? String(gameState.city.population) : null;

  // -------- preload map image (CSS var) ----------
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
    setOppClickPx(null);

    setShowReadyButton(false);
    setIAmReady(false);
    setCountdown(null);

    setElapsedMs(0);
    setRoundStartPerf(performance.now());
    setTimerRunning(gameState.currentRound >= 0);
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

  const matchFinished = !!gameState.finalResult;

  // -------- target px (för reveal direkt efter klick) ----------
  const targetPx = useMemo(() => {
    const c = gameState.city;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    if (!mapProject) return null;
    return mapProject(c.lon, c.lat);
  }, [gameState.city, mapProject]);

  const shouldShowTarget = useMemo(() => {
    return !!hasClickedThisRound || !!oppClickPx || !!debugShowTarget;
  }, [hasClickedThisRound, oppClickPx, debugShowTarget]);

  // -------- socket events ----------
  useEffect(() => {
    if (!socket) return;

    const onStartReadyPrompt = () => {
      // om servern säger "redo-läge" igen, lås upp knappen lokalt
      setStartReadySent(false);
    };

    const onRoundResult = ({ results }) => {
      setTimerRunning(false);
      try {
        const oppRes = results?.[opponentName];
        if (
          oppRes &&
          mapProject &&
          Number.isFinite(oppRes.lon) &&
          Number.isFinite(oppRes.lat)
        ) {
          const px = mapProject(oppRes.lon, oppRes.lat);
          if (px) setOppClickPx(px);
        }
      } catch (_) {}
      setTimeout(() => setShowReadyButton(true), 3500);
    };

    const onNextRoundCountdown = ({ seconds }) => {
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
  }, [socket, opponentName, mapProject]);

  // -------- pointer / lens ----------
  const onPointerMove = (e) => {
    if (hoveringUi) return; // ✅ dölj/pausa lens när musen är på knappar
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

    // ✅ om vi klickar på UI som ligger ovanpå kartan, ignorera kart-klick
    if (hoveringUi) return;

    // Lås input om vi är i ready/countdown-läge
    if (showReadyButton || countdown !== null) return;
    // Lås input om matchen inte startat än (redo-gate)
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

    // distance direkt
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
    if (hoveringUi) return null; // ✅ dölj lens när musen är på UI
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

  // -------- button helpers (NYTT): stoppa bubbling till kartan ----------
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

  const showStartGate = !matchFinished && gameState.currentRound < 0;

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
          <div className="hud-name">{myName}</div>
          <div className="hud-score">{Math.round(myScoreSoFar)}</div>
        </div>
        <div className="hud hud-right">
          <div className="hud-name">{opponentName}</div>
          <div className="hud-score">{matchFinished ? Math.round(oppScoreSoFar) : "—"}</div>
        </div>

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
              {flag ? <span className="city-flag">{flag}</span> : null}
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

        {/* Click markers */}
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
        {oppClickPx && (
          <div
            className="click-marker click-marker-opp"
            style={{ left: oppClickPx.x, top: oppClickPx.y }}
          />
        )}

        {/* Debug target + debug click */}
        {debugShowTarget && targetPx && (
          <div className="debug-dot debug-dot-target" style={{ left: targetPx.x, top: targetPx.y }} />
        )}
        {debugShowTarget && myClickPx && (
          <div className="debug-dot debug-dot-click" style={{ left: myClickPx.x, top: myClickPx.y }} />
        )}

        {/* Ready overlay */}
        {showReadyButton && !matchFinished && (
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
            <button
              className="ready-btn"
              onClick={stop(onPressStartReady)}
              disabled={!mapLoaded || startReadySent}
            >
              {!mapLoaded ? "Laddar karta..." : startReadySent ? "Väntar på andra..." : "Redo"}
            </button>
          </div>
        )}

        {/* Finish overlay */}
        {matchFinished && (
          <div
            className="finish-overlay"
            onMouseEnter={() => setHoveringUiSafe(true)}
            onMouseLeave={() => setHoveringUiSafe(false)}
          >
            <div className="finish-card">
              <div className="finish-title">Slutresultat</div>
              <div className="finish-row">
                <span>{myName}</span>
                <span>{Math.round(myScoreSoFar)}</span>
              </div>
              <div className="finish-row">
                <span>{opponentName}</span>
                <span>{Math.round(oppScoreSoFar)}</span>
              </div>
              <div className="finish-winner">
                {gameState.finalResult.winner === myName
                  ? "Du vann"
                  : gameState.finalResult.winner
                  ? "Du förlorade"
                  : "Oavgjort"}
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
