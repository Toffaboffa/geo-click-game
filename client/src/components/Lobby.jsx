// client/src/components/Lobby.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getMe,
  setLeaderboardVisibility,
  getBadgesCatalog,
  getUserProgress,
  getMyProgress,
  getLeaderboardWide,
} from "../api";

function fmtIntOrDash(v) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}
function fmtPctOrDash(v) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

const DIFFS = [
  { key: "easy", label: "Enkel" },
  { key: "medium", label: "Medel" },
  { key: "hard", label: "Svår" },
];

const LB_VIEWS = [
  { key: "easy", label: "EASY" },
  { key: "medium", label: "MEDEL" },
  { key: "hard", label: "SVÅR" },
  { key: "total", label: "TOTAL" },
  { key: "all", label: "ALLA" },
];

const SORT_KEYS = [
  { key: "ppm", label: "PPM" },
  { key: "pct", label: "PCT" },
  { key: "sp", label: "SP" },
  { key: "vm", label: "VM" },
  { key: "fm", label: "FM" },
];

function safeDiff(d) {
  const v = String(d || "").trim().toLowerCase();
  if (v === "easy" || v === "medium" || v === "hard") return v;
  return "medium";
}

function safeLbMode(m) {
  const v = String(m || "").trim().toLowerCase();
  if (v === "easy" || v === "medium" || v === "hard" || v === "total" || v === "all") return v;
  return "total";
}

function getCell(row, prefix, key) {
  const v = row?.[`${prefix}${key}`];
  if (key === "pct") return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}` : "—";
  if (key === "ppm") return Number.isFinite(Number(v)) ? `${Math.round(Number(v))}` : "—";
  return fmtIntOrDash(v);
}

// ✅ “0 matcher syns inte”: dölj om ALLA sp (spelade) är 0
function hasAnyMatches(row) {
  const keys = ["e_sp", "m_sp", "s_sp", "t_sp"];
  return keys.some((k) => Number(row?.[k] ?? 0) > 0);
}

export default function Lobby({ session, socket, lobbyState, onLogout }) {
  const [challengeName, setChallengeName] = useState("");

  // difficulty val
  const [queueDifficulty, setQueueDifficulty] = useState("medium");
  const [challengeDifficulty, setChallengeDifficulty] = useState("medium");
  const [practiceDifficulty, setPracticeDifficulty] = useState("hard");

  // queue state från servern
  const [queueState, setQueueState] = useState({ queued: false, difficulty: null });

  // Toggle i UI (true = syns i leaderboard)
  const [showMeOnLeaderboard, setShowMeOnLeaderboard] = useState(true);
  const [savingVis, setSavingVis] = useState(false);

  // leaderboard wide
  const [lbView, setLbView] = useState("total"); // easy|medium|hard|total|all
  const [lbSort, setLbSort] = useState("ppm"); // ppm|pct|sp|vm|fm
  const [lbDir, setLbDir] = useState(""); // "" => server default
  const [lbAllSortMode, setLbAllSortMode] = useState("total"); // när view=all: vilken grupp sorterar vi på
  const [lbRows, setLbRows] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState("");

  // Progression modal
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressUser, setProgressUser] = useState(null); // username
  const [badgesCatalog, setBadgesCatalog] = useState([]); // all badge defs
  const [progressData, setProgressData] = useState(null); // user progress
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");

  // About/info modal ( ? )
  const [aboutOpen, setAboutOpen] = useState(false);

  // --- Hämta sparat leaderboard-visibility från servern ---
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getMe(session.sessionId);
        if (cancelled) return;

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

  // --- Socket: queue_state ---
  useEffect(() => {
    if (!socket) return;

    const onQueueState = (s) => {
      const queued = !!s?.queued;
      const difficulty = s?.difficulty ? safeDiff(s.difficulty) : null;
      setQueueState({ queued, difficulty });
      if (difficulty) setQueueDifficulty(difficulty);
    };

    socket.on("queue_state", onQueueState);
    return () => socket.off("queue_state", onQueueState);
  }, [socket]);

  // --- Socket safety: forced logout / auth error ---
  useEffect(() => {
    if (!socket) return;

    const onForcedLogout = (msg) => {
      window.alert(msg || "Du blev utloggad eftersom du loggade in i en annan flik.");
      onLogout?.();
    };

    const onAuthError = (msg) => {
      window.alert(msg || "Ogiltig session, logga in igen.");
      onLogout?.();
    };

    socket.on("forced_logout", onForcedLogout);
    socket.on("auth_error", onAuthError);

    return () => {
      socket.off("forced_logout", onForcedLogout);
      socket.off("auth_error", onAuthError);
    };
  }, [socket, onLogout]);

  const closeProgress = () => {
    setProgressOpen(false);
    setProgressUser(null);
    setProgressData(null);
    setProgressError("");
  };

  const openAbout = () => setAboutOpen(true);
  const closeAbout = () => setAboutOpen(false);

  // ESC stänger modaler
  useEffect(() => {
    if (!progressOpen && !aboutOpen) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (progressOpen) closeProgress();
        if (aboutOpen) closeAbout();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressOpen, aboutOpen]);

  const onToggleShowMe = async () => {
    const next = !showMeOnLeaderboard;
    setShowMeOnLeaderboard(next);
    setSavingVis(true);
    try {
      await setLeaderboardVisibility(session.sessionId, next);
    } catch {
      setShowMeOnLeaderboard(!next);
    } finally {
      setSavingVis(false);
    }
  };

  // Queue start/stop
  const startQueue = () => {
    if (!socket) return;
    const d = safeDiff(queueDifficulty);
    socket.emit("set_queue", { queued: true, difficulty: d });
  };
  const leaveQueue = () => {
    if (!socket) return;
    socket.emit("leave_queue");
  };

  // Övning
  const startSolo = () => {
    if (!socket) return;
    socket.emit("start_solo_match", { difficulty: safeDiff(practiceDifficulty) });
  };

  // Challenge med difficulty
  const challenge = (e) => {
    e.preventDefault();
    if (!socket || !challengeName) return;
    socket.emit("challenge_player", {
      targetUsername: challengeName.trim(),
      difficulty: safeDiff(challengeDifficulty),
    });
    setChallengeName("");
  };

  // =========================
  // Leaderboard wide fetch
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadWide() {
      setLbError("");
      setLbLoading(true);

      try {
        const view = safeLbMode(lbView);

        const modeForQuery = view === "all" ? safeLbMode(lbAllSortMode) : view;
        const mode = modeForQuery === "all" ? "total" : modeForQuery;

        const j = await getLeaderboardWide({
          sessionId: session.sessionId,
          mode,
          sort: String(lbSort || "ppm"),
          dir: lbDir,
          limit: 50,
        });

        const rows = Array.isArray(j?.rows) ? j.rows : [];
        if (cancelled) return;

        // ✅ dölj “0 matcher”
        const nonZero = rows.filter(hasAnyMatches);

        // privacy-toggle (lokal filtrering)
        const filtered = showMeOnLeaderboard
          ? nonZero
          : nonZero.filter((u) => u.namn !== session.username);

        setLbRows(filtered);
      } catch (e) {
        if (!cancelled) setLbError(e?.message || "Kunde inte ladda leaderboard.");
        if (!cancelled) setLbRows([]);
      } finally {
        if (!cancelled) setLbLoading(false);
      }
    }

    loadWide();

    return () => {
      cancelled = true;
    };
  }, [lbView, lbSort, lbDir, lbAllSortMode, showMeOnLeaderboard, session.sessionId, session.username]);

  // UI helper för top3 highlight
  const getRowClass = (rank, usernameOrNamn) => {
    const u = String(usernameOrNamn || "");
    const classes = [];
    if (u === session.username) classes.push("is-me");
    if (rank === 1) classes.push("lb-top1");
    else if (rank === 2) classes.push("lb-top2");
    else if (rank === 3) classes.push("lb-top3");
    return classes.join(" ");
  };

  // Progression helpers
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

  const groupedBadges = useMemo(() => {
    const catalog = Array.isArray(badgesCatalog) ? badgesCatalog : [];
    const map = new Map();

    for (const b of catalog) {
      const groupName = b.groupName ?? b.group_name ?? b.group ?? "Övrigt";
      const groupKey = b.groupKey ?? b.group_key ?? null;

      if (!map.has(groupName)) map.set(groupName, { groupKey, items: [] });
      map.get(groupName).items.push(b);
    }

    const groups = Array.from(map.entries()).map(([groupName, { groupKey, items }]) => {
      const sorted = [...items].sort((a, b) => {
        const ak = Number(a.sortInGroup ?? a.sort_in_group ?? a.order_index ?? 0);
        const bk = Number(b.sortInGroup ?? b.sort_in_group ?? b.order_index ?? 0);
        return ak - bk;
      });
      return { groupName, groupKey, items: sorted };
    });

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

  // Stats i progression (inkl records)
  const progStats = useMemo(() => {
    const s = progressData?.stats || {};
    return {
      played: s.played ?? progressData?.played ?? 0,
      wins: s.wins ?? progressData?.wins ?? 0,
      losses: s.losses ?? progressData?.losses ?? 0,
      avgScore: s.avgScore ?? progressData?.avgScore ?? progressData?.avg_score ?? null,
      pct: s.pct ?? progressData?.pct ?? null,

      bestMatchScore: s.bestMatchScore ?? progressData?.bestMatchScore ?? progressData?.best_match_score ?? null,
      bestWinMargin: s.bestWinMargin ?? progressData?.bestWinMargin ?? progressData?.best_win_margin ?? null,
    };
  }, [progressData]);

  // Derived: queue counts
  const queueCounts = useMemo(() => {
    const qc = lobbyState?.queueCounts || {};
    return {
      easy: Number(qc.easy ?? 0) || 0,
      medium: Number(qc.medium ?? 0) || 0,
      hard: Number(qc.hard ?? 0) || 0,
    };
  }, [lobbyState?.queueCounts]);

  const onlineCount = Number(lobbyState?.onlineCount ?? 0) || 0;

  // Leaderboard columns config
  const viewMode = safeLbMode(lbView);
  const showAllGroups = viewMode === "all";

  const groupsToShow = useMemo(() => {
    if (showAllGroups) return ["easy", "medium", "hard", "total"];
    return [viewMode];
  }, [showAllGroups, viewMode]);

  const wideRows = useMemo(() => lbRows, [lbRows]);

  // ---------- UI ----------
  return (
    <div className="screen">
      <div className="panel">
        <div className="panel-header">
          <h2>Inloggad som: {session.username}</h2>

          <div className="panel-header-actions">
            <button
              type="button"
              className="help-btn"
              onClick={openAbout}
              title="Vad är GeoSense?"
              aria-label="Vad är GeoSense?"
            >
              ?
            </button>
            <button className="logout-btn" onClick={onLogout}>
              Logga ut
            </button>
          </div>
        </div>

        <p>Online just nu: {onlineCount}st.</p>

        {/* Queue status cards */}
        <div className="queue-cards">
          <div className={`queue-card ${queueState.queued && queueState.difficulty === "easy" ? "is-me" : ""}`}>
            <div className="queue-card-title">Enkel</div>
            <div className="queue-card-count">{queueCounts.easy}</div>
            <div className="queue-card-sub">redo</div>
          </div>
          <div className={`queue-card ${queueState.queued && queueState.difficulty === "medium" ? "is-me" : ""}`}>
            <div className="queue-card-title">Medel</div>
            <div className="queue-card-count">{queueCounts.medium}</div>
            <div className="queue-card-sub">redo</div>
          </div>
          <div className={`queue-card ${queueState.queued && queueState.difficulty === "hard" ? "is-me" : ""}`}>
            <div className="queue-card-title">Svår</div>
            <div className="queue-card-count">{queueCounts.hard}</div>
            <div className="queue-card-sub">redo</div>
          </div>
        </div>

        {/* Matchmaking */}
        <div className="lobby-actions">
          <div className="lobby-action-block">
            <div className="lobby-action-title">Match mot slumpvis</div>
            <div className="lobby-action-row">
              <select
                value={queueDifficulty}
                onChange={(e) => setQueueDifficulty(safeDiff(e.target.value))}
                disabled={!socket || queueState.queued}
              >
                {DIFFS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>

              {!queueState.queued ? (
                <button onClick={startQueue} disabled={!socket}>
                  Ställ mig redo
                </button>
              ) : (
                <button onClick={leaveQueue} disabled={!socket}>
                  Lämna kö
                </button>
              )}
            </div>

            {queueState.queued && (
              <div className="queue-me-hint">
                Du står i kö: <strong>{DIFFS.find((d) => d.key === queueState.difficulty)?.label || "—"}</strong>
              </div>
            )}
          </div>

          <div className="lobby-action-block">
            <div className="lobby-action-title">Öva</div>
            <div className="lobby-action-row">
              <select
                value={practiceDifficulty}
                onChange={(e) => setPracticeDifficulty(safeDiff(e.target.value))}
                disabled={!socket}
              >
                {DIFFS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button onClick={startSolo} disabled={!socket}>
                Starta övning
              </button>
            </div>
            <div className="queue-me-hint">Övning startar direkt (ingen kö).</div>
          </div>
        </div>

        {/* Challenge */}
        <form onSubmit={challenge} className="challenge-form">
          <input
            placeholder="Utmana användare..."
            value={challengeName}
            onChange={(e) => setChallengeName(e.target.value)}
          />

          <select value={challengeDifficulty} onChange={(e) => setChallengeDifficulty(safeDiff(e.target.value))}>
            {DIFFS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>

          <button type="submit" disabled={!socket || !challengeName.trim()}>
            Utmana
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

        {/* Leaderboard controls */}
        <div className="lb-header">
          <h3>Topplista</h3>

          <div className="lb-controls">
            <div className="lb-tabs">
              {LB_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={`lb-tab ${lbView === v.key ? "is-active" : ""}`}
                  onClick={() => setLbView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="lb-sort-row">
              {lbView === "all" && (
                <select value={lbAllSortMode} onChange={(e) => setLbAllSortMode(safeLbMode(e.target.value))}>
                  <option value="easy">Sort: Easy</option>
                  <option value="medium">Sort: Medel</option>
                  <option value="hard">Sort: Svår</option>
                  <option value="total">Sort: Total</option>
                </select>
              )}

              <select value={lbSort} onChange={(e) => setLbSort(String(e.target.value || "ppm"))}>
                {SORT_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>

              <select value={lbDir} onChange={(e) => setLbDir(String(e.target.value || ""))}>
                <option value="">Auto</option>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
            </div>
          </div>
        </div>

        {/* ✅ Wide leaderboard output states */}
        {lbLoading ? (
          <div className="lb-loading">Laddar topplista...</div>
        ) : lbError ? (
          <div className="lb-error">{lbError}</div>
        ) : wideRows.length === 0 ? (
          <div className="lb-empty">Inga matcher spelade ännu.</div>
        ) : (
          <div className="lb-wide-wrap">
            <table className="leaderboard leaderboard-wide">
              <thead>
                <tr>
                  <th className="lb-rank">#</th>
                  <th className="lb-name">Spelare</th>
                  <th className="lb-lvl">LVL</th>

                  {groupsToShow.includes("easy") && (
                    <th className="lb-group" colSpan={5}>
                      EASY
                    </th>
                  )}
                  {groupsToShow.includes("medium") && (
                    <th className="lb-group" colSpan={5}>
                      MEDEL
                    </th>
                  )}
                  {groupsToShow.includes("hard") && (
                    <th className="lb-group" colSpan={5}>
                      SVÅR
                    </th>
                  )}
                  {groupsToShow.includes("total") && (
                    <th className="lb-group" colSpan={5}>
                      TOTAL
                    </th>
                  )}
                </tr>

                <tr>
                  <th className="lb-rank" />
                  <th />
                  <th className="lb-lvl" />

                  {groupsToShow.includes("easy") && (
                    <>
                      <th>VM</th>
                      <th>FM</th>
                      <th>SP</th>
                      <th>PCT</th>
                      <th>PPM</th>
                    </>
                  )}
                  {groupsToShow.includes("medium") && (
                    <>
                      <th>VM</th>
                      <th>FM</th>
                      <th>SP</th>
                      <th>PCT</th>
                      <th>PPM</th>
                    </>
                  )}
                  {groupsToShow.includes("hard") && (
                    <>
                      <th>VM</th>
                      <th>FM</th>
                      <th>SP</th>
                      <th>PCT</th>
                      <th>PPM</th>
                    </>
                  )}
                  {groupsToShow.includes("total") && (
                    <>
                      <th>VM</th>
                      <th>FM</th>
                      <th>SP</th>
                      <th>PCT</th>
                      <th>PPM</th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody>
                {wideRows.slice(0, 50).map((u, idx) => {
                  const rank = idx + 1;
                  const name = u?.namn || "—";
                  const lvl = Number(u?.lvl ?? 0);

                  return (
                    <tr key={`${name}-${idx}`} className={getRowClass(rank, name)}>
                      <td className="lb-rank">
                        <span>{rank}</span>
                      </td>

                      <td className="lb-name-cell" style={{ fontWeight: rank <= 3 ? 900 : undefined }}>
                        <button
                          className="lb-name-btn"
                          onClick={() => openProgressFor(name)}
                          title="Visa progression"
                          type="button"
                        >
                          {name}
                        </button>
                      </td>

                      <td className="lb-lvl">{lvl}</td>

                      {groupsToShow.includes("easy") && (
                        <>
                          <td>{getCell(u, "e_", "vm")}</td>
                          <td>{getCell(u, "e_", "fm")}</td>
                          <td>{getCell(u, "e_", "sp")}</td>
                          <td>{getCell(u, "e_", "pct")}</td>
                          <td>{getCell(u, "e_", "ppm")}</td>
                        </>
                      )}

                      {groupsToShow.includes("medium") && (
                        <>
                          <td>{getCell(u, "m_", "vm")}</td>
                          <td>{getCell(u, "m_", "fm")}</td>
                          <td>{getCell(u, "m_", "sp")}</td>
                          <td>{getCell(u, "m_", "pct")}</td>
                          <td>{getCell(u, "m_", "ppm")}</td>
                        </>
                      )}

                      {groupsToShow.includes("hard") && (
                        <>
                          <td>{getCell(u, "s_", "vm")}</td>
                          <td>{getCell(u, "s_", "fm")}</td>
                          <td>{getCell(u, "s_", "sp")}</td>
                          <td>{getCell(u, "s_", "pct")}</td>
                          <td>{getCell(u, "s_", "ppm")}</td>
                        </>
                      )}

                      {groupsToShow.includes("total") && (
                        <>
                          <td>{getCell(u, "t_", "vm")}</td>
                          <td>{getCell(u, "t_", "fm")}</td>
                          <td>{getCell(u, "t_", "sp")}</td>
                          <td>{getCell(u, "t_", "pct")}</td>
                          <td>{getCell(u, "t_", "ppm")}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* About / Info modal */}
      {aboutOpen && (
        <div className="finish-overlay" onClick={closeAbout}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">Vad är GeoSense?</div>

            <div className="about-content">
              <p>
                GeoSense är ett snabbt, nervigt och beroendeframkallande kartspel där du tränar din geografiska
                intuition på riktigt: var ligger staden – exakt? Du får ett stadsnamn, du klickar på världskartan,
                och spelet mäter både precision (hur många km fel) och tempo (hur snabbt du hinner klicka).
              </p>

              <p>Det är lika delar “geografi”, “reaktion” och “kallsvettig finalsekund”.</p>

              <h3>Så spelar du</h3>
              <p>
                En match består av 10 rundor. Varje runda får ni en ny stad och en timer. Du klickar där du tror att
                staden ligger – och ju närmare du är och ju snabbare du är, desto bättre. Spelet räknar ut ditt
                rundresultat och visar efteråt en tydlig resultattabell med alla rundor, tider och avstånd.
              </p>

              <p>
                Viktigt: I GeoSense är lägre totalpoäng bättre. Det är mer “golf” än “high score”: minimera
                felmarginalen och kapa tiden.
              </p>

              <h3>Spellägen</h3>
              <p>
                Du kan spela 1 mot 1 mot slumpvis spelare (eller utmana någon du ser online). Det finns också ett
                övningsläge där du kan nöta upp muskelminnet utan pressen från en motståndare.
              </p>

              <h3>Zoom-lins och tydlig feedback</h3>
              <p>
                Kartan fyller hela skärmen och du får en förstorings-lins runt muspekaren för att sätta klicket mer
                exakt. Efter klicket ser du markörer för både din klickpunkt och målets position, plus avståndet
                mellan dem – så man lär sig snabbt sina “klassiska missar”.
              </p>

              <h3>Topplista och progression</h3>
              <p>
                GeoSense har en Topplista där du kan jämföra statistik som spelade matcher, vinster/förluster,
                winrate och poäng per match. Du kan också välja att dölja dig från topplistan.
              </p>

              <p>
                Klickar du på ett namn öppnas spelarens progression: level + badges. Badges är grupperade för
                överblick och du kan hovra för att se vad varje badge betyder.
              </p>
            </div>

            <div className="finish-actions">
              <button className="hud-btn" onClick={closeAbout}>
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <div className="progress-summary-row">
                    <span>
                      Badges: {earnedSet.size}/{totalBadges} <span className="progress-hint">• Hovra för info</span>
                    </span>
                  </div>

                  <div className="progress-stats-grid">
                    <div className="ps-item">
                      <div className="ps-label">Spelade</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.played)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">Vinster</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.wins)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">Förluster</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.losses)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">Winrate</div>
                      <div className="ps-value">{fmtPctOrDash(progStats.pct)}%</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">Snittpoäng</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.avgScore)}</div>
                    </div>

                    <div className="ps-item">
                      <div className="ps-label">Bästa match</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.bestMatchScore)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">Största vinst</div>
                      <div className="ps-value">
                        {Number.isFinite(Number(progStats.bestWinMargin)) ? fmtIntOrDash(progStats.bestWinMargin) : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="progress-groups">
                  {groupedBadges.map((g, gi) => {
                    const totalInGroup = g.items.length;
                    const earnedInGroup = g.items.reduce((acc, b) => {
                      const code = getBadgeCode(b);
                      return code && earnedSet.has(code) ? acc + 1 : acc;
                    }, 0);

                    const defaultOpen = gi === 0;

                    return (
                      <details key={g.groupName} className="badge-group" open={defaultOpen}>
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
                            const tooltip = b.description || "";

                            return (
                              <div
                                key={code || `${b.name}-${emoji}`}
                                className={`badge-card ${earned ? "is-earned" : "is-missing"}`}
                                data-tooltip={tooltip}
                              >
                                <div className="badge-title">
                                  <span className="badge-emoji">{emoji}</span>
                                  <span className="badge-name">{b.name}</span>
                                  <span className="badge-mini-status">{earned ? "✅" : "⬜"}</span>
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
