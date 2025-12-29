// client/src/components/Lobby.jsx
import React, { useEffect, useMemo, useState } from "react";
import { getMe, setLeaderboardVisibility } from "../api";

export default function Lobby({ session, socket, lobbyState, leaderboard, onLogout }) {
  const [challengeName, setChallengeName] = useState("");

  // ✅ NYTT: toggle för att visa/dölja dig i topplistan
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
        } else if (!cancelled && typeof me?.hidden === "boolean") {
          // backup om servern returnerar hidden också
          setShowMeOnLeaderboard(!me.hidden);
        }
      } catch {
        // om servern inte är uppdaterad än: ignorera
      }
    }

    if (session?.sessionId) load();

    return () => {
      cancelled = true;
    };
  }, [session?.sessionId]);

  const onToggleShowMe = async () => {
    const next = !showMeOnLeaderboard;
    setShowMeOnLeaderboard(next); // direkt respons i UI
    setSavingVis(true);
    try {
      await setLeaderboardVisibility(session.sessionId, next);
    } catch {
      // om servern inte är uppdaterad än: ignorera
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

  // Servern returnerar redan Top 20 och filtrerar hidden = true.
  // Men om du togglar lokalt innan leaderboard hinner refetcha kan vi spegla det i UI:
  const leaderboardRows = useMemo(() => {
    const rows = Array.isArray(leaderboard) ? leaderboard : [];
    const filtered = showMeOnLeaderboard
      ? rows
      : rows.filter((u) => u.username !== session.username);
    return filtered.slice(0, 20);
  }, [leaderboard, showMeOnLeaderboard, session.username]);

  const getRowClass = (rank, username) => {
    const classes = [];
    if (username === session.username) classes.push("is-me");
    if (rank === 1) classes.push("rank-1");
    else if (rank === 2) classes.push("rank-2");
    else if (rank === 3) classes.push("rank-3");
    return classes.join(" ");
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

        {/* ✅ NYTT: leaderboard privacy-toggle */}
        <div className="lobby-actions" style={{ marginTop: 8 }}>
          <button onClick={onToggleShowMe} disabled={savingVis}>
            {showMeOnLeaderboard ? "✅ Visas i topplistan" : "🙈 Dold i topplistan"}
          </button>
        </div>

        <h3>Topplista (Top 20)</h3>

        <table className="leaderboard">
          <thead>
            <tr>
              <th style={{ width: 56, textAlign: "right" }}>#</th>
              <th>Spelare</th>
              <th>Spelade</th>
              <th>Vunna</th>
              <th>Förlorade</th>
              <th>PPM</th>
            </tr>
          </thead>

          <tbody>
            {leaderboardRows.map((u, idx) => {
              const rank = idx + 1;
              const isTop1 = rank === 1;

              return (
                <tr key={u.username} className={getRowClass(rank, u.username)}>
                  <td style={{ textAlign: "right", fontWeight: 900 }}>
                    {rank}
                  </td>

                  <td style={{ fontWeight: rank <= 3 ? 900 : undefined }}>
                    {isTop1 ? <span title="Plats 1" style={{ marginRight: 6 }}>👑</span> : null}
                    {u.username}
                  </td>

                  <td>{u.played}</td>
                  <td>{u.wins}</td>
                  <td>{u.losses}</td>
                  <td>{Number(u.avgScore).toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Tips: lägg CSS för rank-1/2/3 om du vill ha “extra fint” */}
      </div>
    </div>
  );
}
