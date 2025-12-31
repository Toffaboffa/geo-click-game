// client/src/components/Lobby.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getMe,
  setLeaderboardVisibility,
  getBadgesCatalog,
  getUserProgress,
  getMyProgress,
} from "../api";

export default function Lobby({ session, socket, lobbyState, leaderboard, onLogout }) {
  const [challengeName, setChallengeName] = useState("");

  // Toggle i UI (true = syns i leaderboard)
  const [showMeOnLeaderboard, setShowMeOnLeaderboard] = useState(true);
  const [savingVis, setSavingVis] = useState(false);

  // Progression modal
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressUser, setProgressUser] = useState(null); // username
  const [badgesCatalog, setBadgesCatalog] = useState([]); // all badge defs
  const [progressData, setProgressData] = useState(null); // user progress
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  // Hämta sparat läge från servern
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getMe(session.sessionId);
        if (cancelled) return;

        // Normaliserat av api.js: showOnLeaderboard finns alltid
        if (typeof me?.showOnLeaderboard === "boolean") {
          setShowMeOnLeaderboard(me.showOnLeaderboard);
          return;
        }
        if (typeof me?.hidden === "boolean") {
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

  // ESC stänger modal
  useEffect(() => {
    if (!progressOpen) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") closeProgress();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressOpen]);

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
    const filtered = showMeOnLeaderboard
      ? rows
      : rows.filter((u) => u.username !== session.username);
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
    const pctDb = u?.pct;
    if (typeof pctDb === "number" && Number.isFinite(pctDb)) return pctDb.toFixed(1);
    const w = Number(u?.wins ?? 0);
    const l = Number(u?.losses ?? 0);
    const denom = w + l;
    if (denom <= 0) return "-";
    const pct = (100 * w) / denom;
    return pct.toFixed(1);
  };

  // ---------- Progression helpers ----------
  const ensureCatalogLoaded = async () => {
    let catalog = Array.isArray(badgesCatalog) ? badgesCatalog : [];
    if (catalog.length > 0) return catalog;

    const res = await getBadgesCatalog(session.sessionId);
    catalog = Array.isArray(res) ? res : Array.isArray(res?.badges) ? res.badges : [];
    setBadgesCatalog(catalog);
    return catalog;
  };

  const openProgressFor = async (username) => {
    setProgressError("");
    setProgressUser(username);
    setProgressOpen(true);
    setProgressLoading(true);
    setProgressData(null);

    try {
      await ensureCatalogLoaded();

      // Min egen progression kan hämtas via /api/me/progress (enklare)
      const p =
        username === session.username
          ? await getMyProgress(session.sessionId)
          : await getUserProgress(session.sessionId, username);

      setProgressData(p || null);
    } catch (e) {
      setProgressError(e?.message || "Kunde inte ladda progression.");
    } finally {
      setProgressLoading(false);
    }
  };

  const closeProgress = () => {
    setProgressOpen(false);
    setProgressUser(null);
    setProgressData(null);
    setProgressError("");
  };

  const groupedBadges = useMemo(() => {
    const catalog = Array.isArray(badgesCatalog) ? badgesCatalog : [];
    const map = new Map(); // group_name -> { group_key, items[] }

    for (const b of catalog) {
      const groupName =
        b.group_name || b.group_name === ""
          ? b.group_name
          : b.group || "Övrigt";
      const groupKey = b.group_key || null;

      if (!map.has(groupName)) map.set(groupName, { groupKey, items: [] });
      map.get(groupName).items.push(b);
    }

    const groups = Array.from(map.entries()).map(([groupName, { groupKey, items }]) => {
      const sorted = [...items].sort((a, b) => {
        const ak = Number(a.sort_in_group ?? a.order_index ?? 0);
        const bk = Number(b.sort_in_group ?? b.order_index ?? 0);
        return ak - bk;
      });
      return { groupName, groupKey, items: sorted };
    });

    // Sortera grupper: först group_key om det finns (group_1, group_2...), annars alfabetiskt
    const groupKeyToNum = (gk) => {
      if (!gk) return Number.POSITIVE_INFINITY;
      const m = String(gk).match(/(\d+)/);
      return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
    };

    groups.sort((a, b) => {
      const an = groupKeyToNum(a.groupKey);
      const bn = groupKeyToNum(b.groupKey);
      if (an !== bn) return an - bn;
      return a.groupName.localeCompare(b.groupName, "sv");
    });

    return groups;
  }, [badgesCatalog]);

  const earnedSet = useMemo(() => {
    // stöder flera former: earnedBadges, earned, badges, user_badges...
    const earned =
      progressData?.earnedBadges ||
      progressData?.earned ||
      progressData?.badges ||
      progressData?.user_badges ||
      [];
    const s = new Set();
    for (const e of earned) {
      const code = e?.badge_code || e?.code || e?.badgeCode || e?.badge;
      if (code) s.add(code);
    }
    return s;
  }, [progressData]);

  const levelValue =
    typeof progressData?.level === "number"
      ? progressData.level
      : typeof progressData?.badges_count === "number"
      ? progressData.badges_count
      : typeof progressData?.badgesCount === "number"
      ? progressData.badgesCount
      : earnedSet.size;

  const totalBadges = Array.isArray(badgesCatalog) ? badgesCatalog.length : 0;

  const getBadgeCode = (b) => b?.badge_code || b?.code || b?.key || b?.badgeCode || b?.badge;

  // ---------- UI ----------
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

        {/* leaderboard privacy-toggle + progression */}
        <div className="lobby-actions lobby-actions-compact">
          <button onClick={onToggleShowMe} disabled={savingVis}>
            {showMeOnLeaderboard ? "✅ Visas i topplistan" : "🙈 Dold i topplistan"}
          </button>
          <button onClick={() => openProgressFor(session.username)} disabled={!session?.sessionId}>
            ⭐ Min progression
          </button>
        </div>

        <h3>Topplista (Top 20)</h3>

        <table className="leaderboard">
          <thead>
            <tr>
              <th className="lb-rank">#</th>
              <th>Spelare</th>
              <th className="lb-lvl">Lvl</th>
              <th>SM</th>
              <th>VM</th>
              <th>FM</th>
              <th>Pct</th>
              <th>PPM</th>
              <th className="lb-badges">Badges</th>
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

                  <td style={{ fontWeight: rank <= 3 ? 900 : undefined }}>
                    <button
                      className="lb-name-btn"
                      onClick={() => openProgressFor(u.username)}
                      title="Visa progression"
                      type="button"
                    >
                      {u.username}
                    </button>
                  </td>

                  <td className="lb-lvl">{Number(u.level ?? 0)}</td>
                  <td>{u.played}</td>
                  <td>{u.wins}</td>
                  <td>{u.losses}</td>
                  <td>{formatPct(u)}</td>
                  <td>{Number(u.avgScore).toFixed(0)}</td>
                  <td className="lb-badges lb-badges-muted">{Number(u.badgesCount ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Progression modal */}
      {progressOpen && (
        <div className="finish-overlay" onClick={closeProgress}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">
              Progression: {progressUser} • Level {levelValue}
            </div>

            {progressLoading && <div className="progress-loading">Laddar...</div>}

            {progressError && <div className="progress-error">{progressError}</div>}

            {!progressLoading && !progressError && (
              <>
                <div className="progress-summary">
                  Badges: {earnedSet.size}/{totalBadges}{" "}
                  <span className="progress-hint">• Hovra för info</span>
                </div>

                <div className="progress-groups">
                  {groupedBadges.map((g, gi) => {
                    const totalInGroup = g.items.length;
                    const earnedInGroup = g.items.reduce((acc, b) => {
                      const code = getBadgeCode(b);
                      return code && earnedSet.has(code) ? acc + 1 : acc;
                    }, 0);

                    // Överblick först: bara första gruppen är öppen initialt
                    const defaultOpen = gi === 0;

                    return (
                      <details
                        key={g.groupName}
                        className="badge-group"
                        open={defaultOpen}
                      >
                        <summary className="badge-group-summary">
                          <span className="badge-group-title">{g.groupName}</span>
                          <span className="badge-group-count">
                            {earnedInGroup}/{totalInGroup}
                          </span>
                        </summary>

                        <div className="badge-grid">
                          {g.items.map((b) => {
                            const code = getBadgeCode(b);
                            const earned = code ? earnedSet.has(code) : false;
                            const emoji = b.emoji || "🏷️";

                            const tooltip = `${b.name}${b.description ? " — " + b.description : ""}`;

                            return (
                              <div
                                key={code || `${b.name}-${emoji}`}
                                className={`badge-card ${earned ? "is-earned" : "is-missing"}`}
                                title={tooltip}
                                data-tooltip={tooltip}
                              >
                                <div className="badge-title">
                                  <span className="badge-emoji">{emoji}</span>
                                  <span className="badge-name">{b.name}</span>
                                  <span className="badge-mini-status">
                                    {earned ? "✅" : "⬜"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            )}

            <div className="finish-actions">
              <button className="hud-btn" onClick={closeProgress}>
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
