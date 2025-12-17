import React, { useRef, useState } from "react";

export default function Game({
  session,
  socket,
  match,
  gameState,
  onLogout,
  onLeaveMatch
}) {
  const mapRef = useRef(null);
  const [roundTimerStart, setRoundTimerStart] = useState(null);
  const [hasClickedThisRound, setHasClickedThisRound] = useState(false);
  const [lastClickInfo, setLastClickInfo] = useState(null);

  const onMapClick = (e) => {
    if (!socket || !match) return;
    if (hasClickedThisRound) return;

    const rect = mapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const now = performance.now();
    let start = roundTimerStart ?? now;
    if (!roundTimerStart) setRoundTimerStart(now);

    const timeMs = now - start;

    socket.emit("player_click", {
      matchId: match.matchId,
      x,
      y,
      timeMs
    });

    setHasClickedThisRound(true);
    setLastClickInfo({ timeMs, x, y });
  };

  const myName = session.username;
  const opponentName = match.players.find((p) => p !== myName) || "Motståndare";

  const myTotal =
    gameState.finalResult?.totalScores?.[myName] ?? null;
  const oppTotal =
    gameState.finalResult?.totalScores?.[opponentName] ?? null;

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
        <span className="map-hint">
          Klicka på kartan där du tror att staden ligger
        </span>
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
