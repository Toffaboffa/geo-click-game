// client/src/components/Game.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [roundTimerStart, setRoundTimerStart] = useState(null);

  const [myClickPx, setMyClickPx] = useState(null); // {x,y}
  const [myLastClickLL, setMyLastClickLL] = useState(null); // {lon,lat,timeMs}

  const [pointer, setPointer] = useState({ x: 0, y: 0, inside: false });
  const rafRef = useRef(null);

  useEffect(() => {
    setHasClickedThisRound(false);
    setRoundTimerStart(null);
    setMyClickPx(null);
    setMyLastClickLL(null);
  }, [gameState.currentRound]);

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

  // Endast stadnamn (ingen “Afrika”-label)
  const cityLabel = gameState.cityName || "";

  // Debug target dot (kräver city.lat/lon + mapProject)
  const targetPx = useMemo(() => {
    if (!debugShowTarget) return null;
    const c = gameState.city;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
    if (!mapProject) return null;
    return mapProject(c.lon, c.lat);
  }, [debugShowTarget, gameState.city, mapProject]);

  const onPointerMove = (e) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setPointer({ x, y, inside: true });
    });
  };

  const onPointerLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPointer((p) => ({ ...p, inside: false }));
  };

  const onMapClick = (e) => {
    if (!socket || !match) return;
    if (hasClickedThisRound) return;
    if (!mapRef.current) return;

    if (!mapInvert) {
      alert("Kartan är inte kalibrerad än (mapInvert saknas).");
      return;
    }

    const rect = mapRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;

    const now = performance.now();
    const start = roundTimerStart ?? now;
    if (!roundTimerStart) setRoundTimerStart(now);
    const timeMs = now - start;

    const ll = mapInvert(xPx, yPx);
    if (!ll || !Array.isArray(ll) || ll.length !== 2) return;

    const [lon, lat] = ll;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(timeMs)) return;

    socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });

    setHasClickedThisRound(true);
    setMyClickPx({ x: xPx, y: yPx });
    setMyLastClickLL({ lon, lat, timeMs });
  };

  const lensStyle = useMemo(() => {
    if (!pointer.inside || !mapRef.current) return null;
    const rect = mapRef.current.getBoundingClientRect();

    const zoom = 3;
    const bgSizeX = rect.width * zoom;
    const bgSizeY = rect.height * zoom;

    // 80 = ~radie (matchar CSS 160px diameter)
    const bgPosX = -(pointer.x * zoom - 80);
    const bgPosY = -(pointer.y * zoom - 80);

    return {
      left: pointer.x,
      top: pointer.y,
      backgroundSize: `${bgSizeX}px ${bgSizeY}px`,
      backgroundPosition: `${bgPosX}px ${bgPosY}px`,
    };
  }, [pointer]);

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
        {/* Poäng */}
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
          <button
            className="hud-btn"
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleDebugShowTarget();
            }}
          >
            {debugShowTarget ? "Debug: ON" : "Debug"}
          </button>

          <button
            className="hud-btn"
            onClick={(ev) => {
              ev.stopPropagation();
              onLeaveMatch();
            }}
          >
            Lämna
          </button>

          <button
            className="hud-btn"
            onClick={(ev) => {
              ev.stopPropagation();
              onLogout();
            }}
          >
            Logga ut
          </button>
        </div>

        {/* Bottom: endast stadnamn */}
        <div className="city-bottom">
          <div className="city-label">{cityLabel || "…"}</div>
        </div>

        {/* Crosshair */}
        <div
          className="crosshair"
          style={{ left: pointer.x, top: pointer.y, opacity: pointer.inside ? 1 : 0 }}
        />

        {/* Lens */}
        {lensStyle && <div className="lens" style={lensStyle} />}

        {/* Debug: target + din klickpunkt */}
        {debugShowTarget && targetPx && (
          <div className="debug-dot debug-dot-target" style={{ left: targetPx.x, top: targetPx.y }} />
        )}

        {debugShowTarget && myClickPx && (
          <div
            className="debug-dot debug-dot-click"
            style={{ left: myClickPx.x, top: myClickPx.y }}
            title={
              myLastClickLL
                ? `Din klick: lon ${myLastClickLL.lon.toFixed(3)}, lat ${myLastClickLL.lat.toFixed(3)}`
                : "Din klick"
            }
          />
        )}

        {/* Slutoverlay */}
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
                <button
                  className="hud-btn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onLeaveMatch();
                  }}
                >
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
