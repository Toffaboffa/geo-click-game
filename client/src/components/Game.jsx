// client/src/components/Game.jsx
import React, { useEffect, useRef, useState } from "react";

function isInsideEllipse(x, y, w, h) {
  const nx = (x - w / 2) / (w / 2);
  const ny = (y - h / 2) / (h / 2);
  return nx * nx + ny * ny <= 1;
}

export default function Game({
  session,
  socket,
  match,
  gameState,
  onLogout,
  onLeaveMatch,
  mapInvert, // (xPx, yPx) => [lon, lat] | null
  onMapSize, // ({width, height}) => void
}) {
  const mapRef = useRef(null);
  const [roundTimerStart, setRoundTimerStart] = useState(null);
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [lastClickInfo, setLastClickInfo] = useState(null);

  // reset per runda
  useEffect(() => {
    setHasClickedThisRound(false);
    setLastClickInfo(null);
    setRoundTimerStart(null);
  }, [gameState.currentRound]);

  // rapportera kartans storlek upp till App (så kalibreringen blir rätt)
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

  const onMapClick = (e) => {
    if (!socket || !match) return;
    if (hasClickedThisRound) return;
    if (!mapRef.current) return;

    // ✅ INGEN FALLBACK: måste ha mapInvert redo
    if (!mapInvert) {
      alert("Kartan är inte kalibrerad än (mapInvert saknas).");
      return;
    }

    const rect = mapRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;

    // blocka klick utanför glob-ovalen
    if (!isInsideEllipse(xPx, yPx, rect.width, rect.height)) return;

    const now = performance.now();
    const start = roundTimerStart ?? now;
    if (!roundTimerStart) setRoundTimerStart(now);
    const timeMs = now - start;

    const ll = mapInvert(xPx, yPx); // [lon, lat] eller null
    if (!ll || !Array.isArray(ll) || ll.length !== 2) return;

    const [lon, lat] = ll;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(timeMs)) return;

    socket.emit("player_click", { matchId: match.matchId, lon, lat, timeMs });
    setHasClickedThisRound(true);
    setLastClickInfo({ timeMs, lon, lat });
  };

  const myName = session.username;
  const opponentName = match.players.find((p) => p !== myName) || "Motståndare";

  const myTotal = gameState.finalResult?.totalScores?.[myName] ?? null;
  const oppTotal = gameState.finalResult?.totalScores?.[opponentName] ?? null;

  return (
    <div className="screen game-screen">
      <div className="game-header">
        <div>
          <h2>Match #{match.matchId}</h2>
          <p>
            Du: <strong>{myName}</strong>
          </p>
          <p>Mot: {opponentName}</p>
          <p>
            Runda: {gameState.currentRound + 1}/{match.totalRounds}
          </p>
        </div>

        <div className="game-header-actions">
          <button onClick={onLeaveMatch}>Avsluta match</button>
          <button onClick={onLogout}>Logga ut</button>
        </div>

        <div className="city-info">
          <h3>{gameState.cityName || "Väntar på nästa stad..."}</h3>
          {lastClickInfo && (
            <p>
              Din tid: {(lastClickInfo.timeMs / 1000).toFixed(3)} s
              <br />
              Poängen visas när båda har klickat.
            </p>
          )}
        </div>
      </div>

      <div
        className="world-map"
        ref={mapRef}
        onClick={onMapClick}
        title="Klicka där du tror att staden ligger"
      >
        <span className="map-hint">Klicka på kartan där du tror att staden ligger</span>
      </div>

      <div className="results-panel">
        <h3>Rundresultat</h3>
        <ul>
          {gameState.roundResults.map((r) => {
            const myRes = r.results[myName];
            const oppRes = r.results[opponentName];
            return (
              <li key={r.roundIndex}>
                <strong>Runda {r.roundIndex + 1}</strong> – {r.city.name}
                <br />
                Du:{" "}
                {myRes
                  ? `${myRes.distanceKm.toFixed(0)} km, ${(myRes.timeMs / 1000).toFixed(
                      3
                    )} s, poäng ${myRes.score.toFixed(0)}`
                  : "ingen klick"}
                <br />
                {opponentName}:{" "}
                {oppRes
                  ? `${oppRes.distanceKm.toFixed(0)} km, ${(oppRes.timeMs / 1000).toFixed(
                      3
                    )} s, poäng ${oppRes.score.toFixed(0)}`
                  : "ingen klick"}
              </li>
            );
          })}
        </ul>

        {gameState.finalResult && (
          <div className="final-result">
            <h3>Slutresultat</h3>
            {myTotal != null && oppTotal != null && (
              <>
                <p>Dina totalpoäng: {myTotal.toFixed(0)}</p>
                <p>Motståndarens totalpoäng: {oppTotal.toFixed(0)}</p>
              </>
            )}
            <p>
              {gameState.finalResult.winner === myName
                ? "Du vann! 🎉"
                : gameState.finalResult.winner
                ? "Du förlorade."
                : "Oavgjort!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
