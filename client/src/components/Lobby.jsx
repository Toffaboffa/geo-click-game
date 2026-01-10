// client/src/components/Lobby.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import StartPings from "./StartPings";
import logo from "../assets/logo.png";
import LanguageToggle from "../i18n/LanguageToggle.jsx";
import { useI18n } from "../i18n/LanguageProvider.jsx";
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

const DIFFS = ["easy", "medium", "hard"];
const LB_VIEWS = ["easy", "medium", "hard", "total", "all"];

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

// --- Emoji helpers: render flag emojis as deterministic SVGs (Twemoji) ---
const TWEMOJI_SVG_BASE = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg";

function isRegionalIndicator(cp) {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

// Detect standard country flag emojis (two Regional Indicator symbols, e.g. 🇸🇪).
function isFlagEmoji(emoji) {
  if (!emoji) return false;
  const parts = Array.from(String(emoji).trim());
  if (parts.length !== 2) return false;
  const [a, b] = parts;
  const cp1 = a.codePointAt(0);
  const cp2 = b.codePointAt(0);
  return isRegionalIndicator(cp1) && isRegionalIndicator(cp2);
}

function flagEmojiToTwemojiUrl(emoji) {
  if (!isFlagEmoji(emoji)) return null;
  const parts = Array.from(String(emoji).trim());
  const hex = parts.map((ch) => ch.codePointAt(0).toString(16)).join("-");
  return `${TWEMOJI_SVG_BASE}/${hex}.svg`;
}

function FlagOrEmoji({ emoji, alt, className }) {
  const url = flagEmojiToTwemojiUrl(emoji);
  if (url) {
    return (
      <img
        className={className}
        src={url}
        alt={alt || ""}
        draggable="false"
        loading="lazy"
        style={{ width: "1em", height: "1em", verticalAlign: "-0.12em" }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return <>{emoji}</>;
}

export default function Lobby({ session, socket, lobbyState, onLogout }) {
  const { t } = useI18n();
  const [challengeName, setChallengeName] = useState("");

  // Lobby chat toggle (persisted in localStorage)
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      const v = localStorage.getItem("geosense:lobbyChatOpen");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
      // ignore
    }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem("geosense:lobbyChatOpen", chatOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [chatOpen]);

  // difficulty val
  const [queueDifficulty, setQueueDifficulty] = useState("medium");
  const [challengeDifficulty, setChallengeDifficulty] = useState("medium");
  const [practiceDifficulty, setPracticeDifficulty] = useState("hard");

  // queue state från servern
  const [queueState, setQueueState] = useState({ queued: false, difficulty: null });

  // Toggle i UI (true = syns i leaderboard)
  const [showMeOnLeaderboard, setShowMeOnLeaderboard] = useState(true);
  const [meLevel, setMeLevel] = useState(null);
  const [savingVis, setSavingVis] = useState(false);

  // leaderboard wide
  const [lbView, setLbView] = useState("all"); // easy|medium|hard|total|all
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

  // Bug report (discreet link under lobby panel)
  const [bugOpen, setBugOpen] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugCopied, setBugCopied] = useState(false);


  // Lobby chat (försvinner efter 5 min)
  const CHAT_TTL_MS = 5 * 60 * 1000;
  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState([]);
  const chatListRef = useRef(null);


  // Leaderboard modal
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  // --- Hämta sparat leaderboard-visibility från servern ---
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getMe(session.sessionId);
        if (cancelled) return;
        if (me && me.level != null) setMeLevel(Number(me.level));

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
      window.alert(msg || t("errors.forcedLogout"));
      onLogout?.();
    };

    const onAuthError = (msg) => {
      window.alert(msg || t("errors.sessionInvalid"));
      onLogout?.();
    };

    socket.on("forced_logout", onForcedLogout);
    socket.on("auth_error", onAuthError);

    return () => {
      socket.off("forced_logout", onForcedLogout);
      socket.off("auth_error", onAuthError);
    };
  }, [socket, onLogout]);

  // --- Lobbychat: historik + live ---
  useEffect(() => {
    if (!socket) return;

    const onHistory = (payload) => {
      const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
      setChatMsgs(msgs);

      // scrolla till botten efter första render
      requestAnimationFrame(() => {
        const el = chatListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };

    const onMessage = (msg) => {
      if (!msg) return;
      setChatMsgs((prev) => [...prev, msg].slice(-200));
    };

    socket.on("lobby_chat_history", onHistory);
    socket.on("lobby_chat_message", onMessage);

    return () => {
      socket.off("lobby_chat_history", onHistory);
      socket.off("lobby_chat_message", onMessage);
    };
  }, [socket]);

  // Rensa lokalt för att matcha serverns 5-min TTL (även om tabben står öppen)
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - CHAT_TTL_MS;
      setChatMsgs((prev) => prev.filter((m) => (m?.ts ?? 0) >= cutoff));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll när nya meddelanden kommer
  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMsgs.length]);

  const sendChat = () => {
    if (!socket) return;
    const text = chatInput.trim();
    if (!text) return;
    socket.emit("lobby_chat_send", { text });
    setChatInput("");
  };

  const closeProgress = () => {
    setProgressOpen(false);
    setProgressUser(null);
    setProgressData(null);
    setProgressError("");
  };

  const openAbout = () => setAboutOpen(true);

  const closeBug = () => setBugOpen(false);
  const openBug = () => {
    setBugCopied(false);
    setBugOpen(true);
  };

  const buildBugReport = () => {
    const nowIso = new Date().toISOString();
    const info = {
      user: session?.username ?? "",
      time: nowIso,
      url: typeof window !== "undefined" ? window.location?.href : "",
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      lang: typeof navigator !== "undefined" ? navigator.language : "",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen:
        typeof window !== "undefined"
          ? `${window.screen?.width ?? "?"}x${window.screen?.height ?? "?"}`
          : "",
      onlineCount,
      queueCounts,
      queueState,
    };

    return [
      "GeoSense – Bug Report",
      "",
      "Describe what happened (steps, expected vs actual):",
      bugText || "",
      "",
      "Diagnostics:",
      JSON.stringify(info, null, 2),
      "",
    ].join("\n");
  };

  const copyBugReport = async () => {
    const text = buildBugReport();
    try {
      await navigator.clipboard.writeText(text);
      setBugCopied(true);
      setTimeout(() => setBugCopied(false), 1400);
    } catch {
      // Fallback: old browsers
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setBugCopied(true);
        setTimeout(() => setBugCopied(false), 1400);
      } catch {
        // If all else fails, do nothing.
      }
    }
  };

  const BUG_REPORT_EMAIL = "kristoffer.aberg81@gmail.com";

  const emailBugReport = () => {
    const subject = "GeoSense – Bug Report";
    const body = encodeURIComponent(buildBugReport());
    window.location.href = `mailto:${encodeURIComponent(BUG_REPORT_EMAIL)}?subject=${encodeURIComponent(
      subject
    )}&body=${body}`;
  };

  const closeAbout = () => setAboutOpen(false);

  const openLeaderboard = () => setLeaderboardOpen(true);
  const closeLeaderboard = () => setLeaderboardOpen(false);

  // ESC stänger modaler
  useEffect(() => {
    if (!progressOpen && !aboutOpen && !leaderboardOpen && !bugOpen) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (progressOpen) closeProgress();
        if (aboutOpen) closeAbout();
        if (leaderboardOpen) closeLeaderboard();
        if (bugOpen) closeBug();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressOpen, aboutOpen, leaderboardOpen, bugOpen]);

  const setShowMe = async (next) => {
    const val = !!next;
    const prev = showMeOnLeaderboard;
    setShowMeOnLeaderboard(val);
    setSavingVis(true);
    try {
      await setLeaderboardVisibility(session.sessionId, val);
    } catch {
      setShowMeOnLeaderboard(prev);
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
        const filtered = showMeOnLeaderboard ? nonZero : nonZero.filter((u) => u.namn !== session.username);

        setLbRows(filtered);
      } catch (e) {
        if (!cancelled)
          setLbError(
            e?.message
              ? String(e.message).startsWith("errors.")
                ? t(e.message)
                : e.message
              : t("errors.leaderboardLoadFailed")
          );
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
      setProgressError(
        e?.message
          ? String(e.message).startsWith("errors.")
            ? t(e.message)
            : e.message
          : t("errors.progressionLoadFailed")
      );
    } finally {
      setProgressLoading(false);
    }
  };

  const groupedBadges = useMemo(() => {
    const catalog = Array.isArray(badgesCatalog) ? badgesCatalog : [];
    const map = new Map();

    for (const b of catalog) {
      const groupName = b.groupName ?? b.group_name ?? b.group ?? t("common.other");
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
      <StartPings />
      <img className="screen-logo" src={logo} alt={t("common.appName")} />
      <div className="screen-topbar">
        <LanguageToggle />
      </div>

      {/* ✅ Viktigt: wrappar panel + footer i en egen kolumn-stack så den hamnar UNDER, inte bredvid */}
      <div className="lobby-layout">
        <div className="lobby-main">
          <div className="panel">
          <div className="panel-header">
            <h2>{t("lobby.loggedInAs", { user: session.username })}{meLevel != null && Number.isFinite(Number(meLevel)) ? ` · L${Math.round(Number(meLevel))}` : ""}</h2>

            <div className="panel-header-actions">
              <button
                type="button"
                className="help-btn"
                onClick={openAbout}
                title={t("lobby.aboutTitle")}
                aria-label={t("lobby.aboutTitle")}
              >
                ?
              </button>
              <button className="logout-btn" onClick={onLogout}>
                {t("common.logout")}
              </button>
            </div>
          </div>

          <div className="panel-sub-actions">
            <button type="button" className="sub-action-btn" onClick={openLeaderboard}>
              🏆 {t("lobby.leaderboard")}
            </button>
            <button
              type="button"
              className="sub-action-btn"
              onClick={() => openProgressFor(session.username)}
              disabled={!session?.sessionId}
            >
              ⭐ {t("lobby.myProgress")}
            </button>
            <button
              type="button"
              className={`sub-action-btn ${chatOpen ? "" : "is-off"}`}
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              title={chatOpen ? t("lobby.chat.toggleHide") : t("lobby.chat.toggleShow")}
            >
              💬 {chatOpen ? t("lobby.chat.toggleHide") : t("lobby.chat.toggleShow")}
            </button>
          </div>

          <p>{t("lobby.onlineNowCount", { n: onlineCount })}</p>

          {/* Queue status cards */}
          <div className="queue-cards">
            <div className={`queue-card ${queueState.queued && queueState.difficulty === "easy" ? "is-me" : ""}`}>
              <div className="queue-card-title">{t("common.difficulty.easy")}</div>
              <div className="queue-card-count">{queueCounts.easy}</div>
              <div className="queue-card-sub">{t("lobby.queue.ready")}</div>
            </div>
            <div className={`queue-card ${queueState.queued && queueState.difficulty === "medium" ? "is-me" : ""}`}>
              <div className="queue-card-title">{t("common.difficulty.medium")}</div>
              <div className="queue-card-count">{queueCounts.medium}</div>
              <div className="queue-card-sub">{t("lobby.queue.ready")}</div>
            </div>
            <div className={`queue-card ${queueState.queued && queueState.difficulty === "hard" ? "is-me" : ""}`}>
              <div className="queue-card-title">{t("common.difficulty.hard")}</div>
              <div className="queue-card-count">{queueCounts.hard}</div>
              <div className="queue-card-sub">{t("lobby.queue.ready")}</div>
            </div>
          </div>

          {/* Matchmaking */}
          <div className="lobby-actions">
            <div className="lobby-action-block">
              <div className="lobby-action-title">{t("lobby.matchRandom.title")}</div>
              <div className="lobby-action-row">
                <select
                  value={queueDifficulty}
                  onChange={(e) => setQueueDifficulty(safeDiff(e.target.value))}
                  disabled={!socket || queueState.queued}
                >
                  {DIFFS.map((d) => (
                    <option key={d} value={d}>
                      {t(`common.difficulty.${d}`)}
                    </option>
                  ))}
                </select>

                {!queueState.queued ? (
                  <button onClick={startQueue} disabled={!socket}>
                    {t("lobby.matchRandom.readyUp")}
                  </button>
                ) : (
                  <button onClick={leaveQueue} disabled={!socket}>
                    {t("lobby.matchRandom.leaveQueue")}
                  </button>
                )}
              </div>
            </div>

            <div className="lobby-action-block">
              <div className="lobby-action-title">{t("common.modes.practice")}</div>
              <div className="lobby-action-row">
                <select
                  value={practiceDifficulty}
                  onChange={(e) => setPracticeDifficulty(safeDiff(e.target.value))}
                  disabled={!socket}
                >
                  {DIFFS.map((d) => (
                    <option key={d} value={d}>
                      {t(`common.difficulty.${d}`)}
                    </option>
                  ))}
                </select>
                <button onClick={startSolo} disabled={!socket}>
                  {t("lobby.practice.start")}
                </button>
              </div>
            </div>
          </div>

          {/* Challenge */}
          <form onSubmit={challenge} className="challenge-form">
            <input
              placeholder={t("lobby.challenge.placeholder")}
              value={challengeName}
              onChange={(e) => setChallengeName(e.target.value)}
            />

            <select value={challengeDifficulty} onChange={(e) => setChallengeDifficulty(safeDiff(e.target.value))}>
              {DIFFS.map((d) => (
                <option key={d} value={d}>
                  {t(`common.difficulty.${d}`)}
                </option>
              ))}
            </select>

            <button type="submit" disabled={!socket || !challengeName.trim()}>
              {t("lobby.challenge.btn")}
            </button>
          </form>
        </div>

          {chatOpen && (
            <div className="lobby-chat" aria-label={t("lobby.chat.title")}>
            <div className="lobby-chat-header">
              <span className="lobby-chat-title">💬 {t("lobby.chat.title")}</span>
              <span className="lobby-chat-meta">{t("lobby.chat.ttl")}</span>
            </div>

            <div className="lobby-chat-messages" ref={chatListRef}>
              {chatMsgs.length === 0 ? (
                <div className="lobby-chat-empty">{t("lobby.chat.empty")}</div>
              ) : (
                chatMsgs.map((m) => (
                  <div key={m.id || `${m.user}-${m.ts}`} className="lobby-chat-msg">
                    <div className="lobby-chat-msg-top">
                      <span className="lobby-chat-user">{m.user}{Number.isFinite(Number(m.level)) ? ` · L${Number(m.level)}` : ""}</span>
                      <span className="lobby-chat-time">
                        {new Date(m.ts || 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="lobby-chat-text">{m.text}</div>
                  </div>
                ))
              )}
            </div>

            <div className="lobby-chat-inputrow">
              <input
                className="lobby-chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t("lobby.chat.placeholder")}
                maxLength={240}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button type="button" className="lobby-chat-send" onClick={sendChat} disabled={!socket || !chatInput.trim()}>
                {t("lobby.chat.send")}
              </button>
            </div>
          </div>
          )}

        </div>

        {/* ✅ Under panel + chat */}
        <div className="lobby-footer">
          <button type="button" className="bug-report-btn" onClick={openBug}>
            🐞 {t("lobby.bugReport")}
          </button>
        </div>
      </div>

      {/* Topplista modal */}
      {leaderboardOpen && (
        <div className="finish-overlay" onClick={closeLeaderboard}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="lb-modal-head">
              <div className="finish-title">{t("lobby.leaderboard")}</div>

              <div className="lb-modal-actions">
                <label className="lb-visibility">
                  <input
                    type="checkbox"
                    checked={showMeOnLeaderboard}
                    onChange={(e) => setShowMe(e.target.checked)}
                    disabled={savingVis}
                  />
                  <span>{showMeOnLeaderboard ? t("lobby.lb.visible") : t("lobby.lb.hidden")}</span>
                </label>

                <button className="hud-btn" onClick={closeLeaderboard} type="button">
                  {t("common.close")}
                </button>
              </div>
            </div>

            <div className="lb-controls lb-controls-modal">
              <div className="lb-tabs">
                {LB_VIEWS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`lb-tab ${lbView === v ? "is-active" : ""}`}
                    onClick={() => setLbView(v)}
                  >
                    {v === "all" ? t("lobby.lb.view.all") : t(`lobby.lb.groups.${v}`)}
                  </button>
                ))}
              </div>

              <div className="lb-sort-row">
                {lbView === "all" && (
                  <select value={lbAllSortMode} onChange={(e) => setLbAllSortMode(safeLbMode(e.target.value))}>
                    <option value="easy">{t("lobby.lb.sortOption", { mode: t("common.difficulty.easy") })}</option>
                    <option value="medium">{t("lobby.lb.sortOption", { mode: t("common.difficulty.medium") })}</option>
                    <option value="hard">{t("lobby.lb.sortOption", { mode: t("common.difficulty.hard") })}</option>
                    <option value="total">{t("lobby.lb.sortOption", { mode: t("common.difficulty.total") })}</option>
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
                  <option value="">{t("common.auto")}</option>
                  <option value="asc">{t("common.asc")}</option>
                  <option value="desc">{t("common.desc")}</option>
                </select>
              </div>
            </div>

            {/* ✅ Wide leaderboard output states */}
            {lbLoading ? (
              <div className="lb-loading">{t("lobby.lb.loading")}</div>
            ) : lbError ? (
              <div className="lb-error">{lbError}</div>
            ) : wideRows.length === 0 ? (
              <div className="lb-empty">{t("lobby.lb.empty")}</div>
            ) : (
              <div className="lb-wide-wrap">
                <table className="leaderboard leaderboard-wide">
                  <thead>
                    {showAllGroups ? (
                      <>
                        <tr>
                          <th className="lb-left-spacer" colSpan={3} />

                          {groupsToShow.includes("easy") && (
                            <th className="lb-group-head lb-easy lb-gstart" colSpan={5}>
                              {t("lobby.lb.groups.easy")}
                            </th>
                          )}
                          {groupsToShow.includes("medium") && (
                            <th className="lb-group-head lb-medium lb-gstart" colSpan={5}>
                              {t("lobby.lb.groups.medium")}
                            </th>
                          )}
                          {groupsToShow.includes("hard") && (
                            <th className="lb-group-head lb-hard lb-gstart" colSpan={5}>
                              {t("lobby.lb.groups.hard")}
                            </th>
                          )}
                          {groupsToShow.includes("total") && (
                            <th className="lb-group-head lb-total lb-gstart" colSpan={5}>
                              {t("lobby.lb.groups.total")}
                            </th>
                          )}
                        </tr>

                        <tr>
                          <th className="lb-rank">#</th>
                          <th className="lb-name">{t("lobby.lb.player")}</th>
                          <th className="lb-lvl">LVL</th>

                          {groupsToShow.includes("easy") && (
                            <>
                              <th className="lb-sub lb-easy lb-gstart">VM</th>
                              <th className="lb-sub lb-easy">FM</th>
                              <th className="lb-sub lb-easy">SP</th>
                              <th className="lb-sub lb-easy">PCT</th>
                              <th className="lb-sub lb-easy">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("medium") && (
                            <>
                              <th className="lb-sub lb-medium lb-gstart">VM</th>
                              <th className="lb-sub lb-medium">FM</th>
                              <th className="lb-sub lb-medium">SP</th>
                              <th className="lb-sub lb-medium">PCT</th>
                              <th className="lb-sub lb-medium">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("hard") && (
                            <>
                              <th className="lb-sub lb-hard lb-gstart">VM</th>
                              <th className="lb-sub lb-hard">FM</th>
                              <th className="lb-sub lb-hard">SP</th>
                              <th className="lb-sub lb-hard">PCT</th>
                              <th className="lb-sub lb-hard">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("total") && (
                            <>
                              <th className="lb-sub lb-total lb-gstart">VM</th>
                              <th className="lb-sub lb-total">FM</th>
                              <th className="lb-sub lb-total">SP</th>
                              <th className="lb-sub lb-total">PCT</th>
                              <th className="lb-sub lb-total">PPM</th>
                            </>
                          )}
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr>
                          <th className="lb-rank">#</th>
                          <th className="lb-name">{t("lobby.lb.player")}</th>
                          <th className="lb-lvl">LVL</th>

                          {groupsToShow.includes("easy") && (
                            <th className="lb-group" colSpan={5}>
                              {t("lobby.lb.groups.easy")}
                            </th>
                          )}
                          {groupsToShow.includes("medium") && (
                            <th className="lb-group" colSpan={5}>
                              {t("lobby.lb.groups.medium")}
                            </th>
                          )}
                          {groupsToShow.includes("hard") && (
                            <th className="lb-group" colSpan={5}>
                              {t("lobby.lb.groups.hard")}
                            </th>
                          )}
                          {groupsToShow.includes("total") && (
                            <th className="lb-group" colSpan={5}>
                              {t("lobby.lb.groups.total")}
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
                      </>
                    )}
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
        </div>
      )}

      {/* About / Info modal */}
      {aboutOpen && (
        <div className="finish-overlay" onClick={closeAbout}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">{t("lobby.aboutTitle")}</div>

            <div className="about-content">
              <p>{t("lobby.about.p1")}</p>
              <p>{t("lobby.about.p2")}</p>

              <h3>{t("lobby.about.howTitle")}</h3>
              <p>{t("lobby.about.p3")}</p>
              <p>{t("lobby.about.p4")}</p>

              <h3>{t("lobby.about.modesTitle")}</h3>
              <p>{t("lobby.about.p5")}</p>

              <h3>{t("lobby.about.lensTitle")}</h3>
              <p>{t("lobby.about.p6")}</p>

              <h3>{t("lobby.about.progressTitle")}</h3>
              <p>{t("lobby.about.p7")}</p>
              <p>{t("lobby.about.p8")}</p>
            </div>

            <div className="finish-actions">
              <button className="hud-btn" onClick={closeAbout}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bug report modal */}
      {bugOpen && (
        <div className="finish-overlay" onClick={closeBug}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">{t("lobby.bugReportTitle")}</div>

            <div className="about-content">
              <p>{t("lobby.bugReportHint")}</p>

              <textarea
                className="bug-report-text"
                value={bugText}
                onChange={(e) => setBugText(e.target.value)}
                placeholder={t("lobby.bugReportPlaceholder")}
              />

              <div className="bug-report-actions">
                <button type="button" className="hud-btn" onClick={copyBugReport}>
                  {bugCopied ? `✅ ${t("lobby.bugReportCopied")}` : t("lobby.bugReportCopy")}
                </button>
                <button type="button" className="hud-btn" onClick={emailBugReport}>
                  ✉️ {t("lobby.bugReportEmail")}
                </button>
                <button type="button" className="hud-btn" onClick={closeBug}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progression modal */}
      {progressOpen && (
        <div className="finish-overlay" onClick={closeProgress}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">
              {t("lobby.progress.title", { user: progressUser, levelLabel: t("common.level"), level: levelValue })}
            </div>

            {progressLoading && <div className="progress-loading">{t("common.loading")}</div>}
            {progressError && <div className="progress-error">{progressError}</div>}

            {!progressLoading && !progressError && (
              <>
                <div className="progress-summary">
                  <div className="progress-stats-grid">
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsPlayed")}</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.played)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsWins")}</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.wins)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsLosses")}</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.losses)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsWinrate")}</div>
                      <div className="ps-value">{fmtPctOrDash(progStats.pct)}%</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsAvgScore")}</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.avgScore)}</div>
                    </div>

                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsBestMatch")}</div>
                      <div className="ps-value">{fmtIntOrDash(progStats.bestMatchScore)}</div>
                    </div>
                    <div className="ps-item">
                      <div className="ps-label">{t("lobby.progress.statsBestWin")}</div>
                      <div className="ps-value">
                        {Number.isFinite(Number(progStats.bestWinMargin)) ? fmtIntOrDash(progStats.bestWinMargin) : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ✅ Emoji-överblick (alla badges som endast emojis) */}
                <div className="badge-overview-wrap">
                  <div className="progress-summary-row">
                    <span>
                      {t("lobby.progress.badgesLine", {
                        label: t("common.badges"),
                        earned: earnedSet.size,
                        total: totalBadges,
                        hover: t("common.hoverForInfo"),
                      })}
                    </span>
                  </div>
                  <div className="badge-overview">
                    {groupedBadges.map((g) =>
                      g.items.map((b) => {
                        const code = getBadgeCode(b);
                        const earned = code ? earnedSet.has(code) : false;
                        const emoji = b.emoji || "🏷️";

                        const tooltipTitle = b.name || "";
                        const tooltipDesc = b.description || "";

                        return (
                          <span
                            key={code || `${g.groupName}-${b.name}-${emoji}`}
                            className={`badge-emoji-only ${earned ? "is-earned" : "is-missing"}`}
                            aria-label={tooltipTitle}
                            title=""
                          >
                            <FlagOrEmoji emoji={emoji} alt={tooltipTitle} className="badge-flag" />

                            {(tooltipTitle || tooltipDesc) && (
                              <span className="badge-tooltip" role="tooltip">
                                <span className="badge-tooltip-title">{tooltipTitle}</span>
                                <span className="badge-tooltip-desc">{tooltipDesc}</span>
                              </span>
                            )}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="finish-actions">
              <button className="hud-btn" onClick={closeProgress}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
