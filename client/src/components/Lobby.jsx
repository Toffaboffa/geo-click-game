import React, { useState } from "react";

export default function Lobby({
  session,
  socket,
  lobbyState,
  leaderboard,
  onLogout
}) {
  const [challengeName, setChallengeName] = useState("");

  const startRandom = () => {
    if (!socket) return;
    socket.emit("start_random_match");
  };

  const startSolo = () => {
    if (!socket) return;
    socket.emit("start_solo_match");
  };

  const challenge = (e) => {
    e.preventDefault();
    if (!socket || !challengeName) return;
    socket.emit("challenge_player", challengeName);
    setChallengeName("");
  };

  return (
    <div className="screen">
      <div className="panel">
        <div className="panel-header">
          <h2>Hej, {session.username}</h2>
          <button onClick={onLogout}>Logga ut</button>
        </div>

        <p>Online spelare: {lobbyState.onlineCount}</p>

        <div className="lobby-actions">
          <button onClick={startRandom} disabled={!socket}>
            Spela mot slumpvis spelare
          </button>

          <button onClick={startSolo} disabled={!socket}>
            Spela solo (random-bot)
          </button>
        </div>

        <form onSubmit={challenge} className="challenge-form">
          <input
            placeholder="Utmanar användare..."
            value={challengeName}
            onChange={(e) => setChallengeName(e.target.value)}
          />
          <button type="submit" disabled={!socket}>
            Utmanar spelare
          </button>
        </form>

        <h3>Topplista</h3>
        <table className="leaderboard">
          <thead>
            <tr>
              <th>Spelare</th>
              <th>Spelade</th>
              <th>Vunna</th>
              <th>Förlorade</th>
              <th>Genomsnittlig poäng</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((u) => (
              <tr key={u.username}>
                <td>{u.username}</td>
                <td>{u.played}</td>
                <td>{u.wins}</td>
                <td>{u.losses}</td>
                <td>{u.avgScore.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
