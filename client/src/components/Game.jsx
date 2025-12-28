// client/src/components/Game.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

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

  // --- click state ---
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [myClickPx, setMyClickPx] = useState(null); // {x,y}
  const [myLastClickLL, setMyLastClickLL] = useState(null); // {lon,lat,timeMs}
  const [oppClickPx, setOppClickPx] = useState(null); // {x,y} after round_result if available

  // --- pointer + lens ---
  const [pointer, setPointer] = useState({ x: 0, y: 0, inside: false });
  const rafRef = useRef(null);

  // --- timer (start on round start, stop on click) ---
  const [roundStartPerf, setRoundStartPerf] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  // --- ready / countdown ---
  const [showReadyButton, setShowReadyButton] = useState(false);
  const [iAmReady, setIAmReady] = useState(false);
  const [countdown, setCountdown] = useState(null); // number | null

  // -------- city label ----------
  const cityLabel = shortCityName(gameState.cityName || gameState.city?.name || "");

  // -------- reset per ny runda ----------
  useEffect(() => {
    setHasClickedThisRound(false);
    setMyClickPx(null);
    setMyLastClickLL(null);
    setOppClickPx(null);

    setShowReadyButton(false);
    setIAmReady(false);
    setCountdown(null);

    setElapsedMs(0);
    setRoundStartPerf(performance.now());
    // starta timer när vi faktiskt har en runda
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

  // -------- debug target dot ----------
  const targetPx = useMemo(() => {
    if (!debugShowTarget) return null;
    const c = gameState.city;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    if (!mapProject) return null;
    return mapProject(c.lon, c.lat);
  }, [debugShowTarget, gameState.city, mapProject]);

  // -------- socket events ----------
  useEffect(() => {
    if (!socket) return;

    const onRoundResult = ({ results }) => {
      // stoppa timer (om den inte redan är stoppad)
      setTimerRunning(false);

      // försök rita motståndarens klick om servern skickar lon/lat
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

      // visa ready-knapp efter 3-4s (client-side)
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

    socket.on("round_result", onRoundResult);
    socket.on("next_round_countdown", onNextRoundCountdown);

    return () => {
      socket.off("round_result", onRoundResult);
      socket.off("next_round_countdown", onNextRoundCountdown);
    };
  }, [socket, opponentName, mapProject]);

  // -------- pointer / lens ----------
  const onPointerMove = (e) => {
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

    // Lås input om vi är i ready/countdown-läge
    if (showReadyButton || countdown !== null) return;

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

    // stoppa timer exakt när man klickar
    setTimerRunning(false);
    const timeMs = elapsedMs;

    socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });

    setHasClickedThisRound(true);
    setMyClickPx({ x: xPx, y: yPx });
    setMyLastClickLL({ lon, lat, timeMs });
  };

  // -------- lens style ----------
  const lensStyle = useMemo(() => {
    if (!pointer.inside || !mapRef.current) return null;
    const rect = mapRef.current.getBoundingClientRect();

    const zoom = 3;
    const bgSizeX = rect.width * zoom;
    const bgSizeY = rect.height * zoom;

    // 80 = halva 160px (lens)
    const bgPosX = -(pointer.x * zoom - 80);
    const bgPosY = -(pointer.y * zoom - 80);

    return {
      left: pointer.x,
      top: pointer.y,
      backgroundSize: `${bgSizeX}px ${bgSizeY}px`,
      backgroundPosition: `${bgPosX}px ${bgPosY}px`,
    };
  }, [pointer]);

  const onPressReady = () => {
    if (!socket || !match) return;
    if (iAmReady) return;
    setIAmReady(true);
    socket.emit("player_ready", { matchId: match.matchId, roundIndex: gameState.currentRound });
  };

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
        <div className="hud-actions">
          <button className="hud-btn" onClick={onToggleDebugShowTarget}>
            {debugShowTarget ? "Debug: ON" : "Debug"}
          </button>
          <button className="hud-btn" onClick={onLeaveMatch}>
            Lämna
          </button>
          <button className="hud-btn" onClick={onLogout}>
            Logga ut
          </button>
        </div>

        {/* Bottom strip (fullbredd tonad) */}
        <div className="city-bottom">
          <div className="city-strip">
            <div className="city-label">{cityLabel || "…"}</div>
            <div className="city-timer">{fmtMs(elapsedMs)}s</div>
            {countdown !== null && countdown > 0 && (
              <div className="city-countdown">Nästa runda om {countdown}s</div>
            )}
          </div>
        </div>

        {/* Crosshair (tonad, liten) */}
        <div
          className="crosshair"
          style={{ left: pointer.x, top: pointer.y, opacity: pointer.inside ? 1 : 0 }}
        />

        {/* Lens */}
        {lensStyle && <div className="lens" style={lensStyle} />}

        {/* Click markers */}
        {myClickPx && (
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
        )}
        {oppClickPx && (
          <div className="click-marker click-marker-opp" style={{ left: oppClickPx.x, top: oppClickPx.y }} />
        )}

        {/* Debug target + debug click */}
        {debugShowTarget && targetPx && (
          <div className="debug-dot debug-dot-target" style={{ left: targetPx.x, top: targetPx.y }} />
        )}
        {debugShowTarget && myClickPx && (
          <div
            className="debug-dot debug-dot-click"
            style={{ left: myClickPx.x, top: myClickPx.y }}
          />
        )}

        {/* Ready overlay */}
        {showReadyButton && !matchFinished && (
          <div className="ready-overlay">
            <button className="ready-btn" onClick={onPressReady} disabled={iAmReady}>
              {iAmReady ? "Väntar på andra..." : "Redo för nästa"}
            </button>
          </div>
        )}

        {/* Finish overlay (oförändrad) */}
        {matchFinished && (
          <div className="finish-overlay">
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
                <button className="hud-btn" onClick={onLeaveMatch}>
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
