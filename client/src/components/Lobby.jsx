// client/src/components/Lobby.jsx
import React, { useEffect, useMemo, useState } from "react";
import { getMe, setLeaderboardVisibility } from "../api";

export default function Lobby({ session, socket, lobbyState, leaderboard, onLogout }) {
  const [challengeName, setChallengeName] = useState("");
  // Toggle i UI (true = syns i leaderboard)
  const [showMeOnLeaderboard, setShowMeOnLeaderboard] = useState(true);
  const [savingVis, setSavingVis] = useState(false);

  // Hämta sparat läge från servern
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getMe(session.sessionId);
        if (!cancelled && typeof me?.showOnLeaderboard === "boolean") {
          setShowMeOnLeaderboard(me.showOnLeaderboard);
          return;
        }
        if (!cancelled && typeof me?.hidden === "boolean") {
          setShowMeOnLeaderboard(!me.hidden);
        }
      } catch {
        // ignorera
      }
    }

    if (session?.sessionId) load();
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId]);

  const onToggleShowMe = async () => {
    const next = !showMeOnLeaderboard;
    setShowMeOnLeaderboard(next);
    setSavingVis(true);
    try {
      await setLeaderboardVisibility(session.sessionId, next);
    } catch {
      // ignorera
    } finally {
      setSavingVis(false);
    }
  };

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

  // Servern returnerar top 20 och filtrerar hidden + played>0.
  // Men om du togglar lokalt innan leaderboard hinner refetcha: spegla det i UI.
  const leaderboardRows = useMemo(() => {
    const rows = Array.isArray(leaderboard) ? leaderboard : [];
    const filtered = showMeOnLeaderboard ? rows : rows.filter((u) => u.username !== session.username);
    return filtered.slice(0, 20);
  }, [leaderboard, showMeOnLeaderboard, session.username]);

  const getRowClass = (rank, username) => {
    const classes = [];
    if (username === session.username) classes.push("is-me");
    if (rank === 1) classes.push("lb-top1");
    else if (rank === 2) classes.push("lb-top2");
    else if (rank === 3) classes.push("lb-top3");
    return classes.join(" ");
  };

  const formatPct = (u) => {
    // Primärt: använd pct från server (DB)
    const pctDb = u?.pct;
    if (typeof pctDb === "number" && Number.isFinite(pctDb)) return pctDb.toFixed(1);

    // Backup: räkna i klient om pct saknas
    const w = Number(u?.wins ?? 0);
    const l = Number(u?.losses ?? 0);
    const denom = w + l;
    if (denom <= 0) return "-";
    const pct = (100 * w) / denom;
    return pct.toFixed(1);
  };

  return (
    <div className="screen">
      <div className="panel">
        <div className="panel-header">
          <h2>Inloggad som: {session.username}</h2>
          <button onClick={onLogout}>Logga ut</button>
        </div>

        <p>Online just nu: {lobbyState.onlineCount}st.</p>

        <div className="lobby-actions">
          <button onClick={startRandom} disabled={!socket}>
            Spela mot slumpvis spelare
          </button>
          <button onClick={startSolo} disabled={!socket}>
            Öva
          </button>
        </div>

        <form onSubmit={challenge} className="challenge-form">
          <input
            placeholder="Utmana användare..."
            value={challengeName}
            onChange={(e) => setChallengeName(e.target.value)}
          />
          <button type="submit" disabled={!socket}>
            Utmana spelare
          </button>
        </form>

        {/* leaderboard privacy-toggle */}
        <div className="lobby-actions" style={{ marginTop: 8 }}>
          <button onClick={onToggleShowMe} disabled={savingVis}>
            {showMeOnLeaderboard ? "✅ Visas i topplistan" : "🙈 Dold i topplistan"}
          </button>
        </div>

        <h3>Topplista (Top 20)</h3>

        <table className="leaderboard">
          <thead>
            <tr>
              <th className="lb-rank">#</th>
              <th>Spelare</th>
              <th>SM</th>
              <th>VM</th>
              <th>FM</th>
              <th>Pct</th>
              <th>PPM</th>
            </tr>
          </thead>
          <tbody>
            {leaderboardRows.map((u, idx) => {
              const rank = idx + 1;
              return (
                <tr key={u.username} className={getRowClass(rank, u.username)}>
                  <td className="lb-rank">
                    <span>{rank}</span>
                  </td>
                  <td style={{ fontWeight: rank <= 3 ? 900 : undefined }}>{u.username}</td>
                  <td>{u.played}</td>
                  <td>{u.wins}</td>
                  <td>{u.losses}</td>
                  <td>{formatPct(u)}</td>
                  <td>{Number(u.avgScore).toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
