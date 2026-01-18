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
  createFeedback,
  getFeedbackList,
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



function eloTrendMeta(recent) {
  const arr = Array.isArray(recent)
    ? recent
        .map((x) => Number(x))
        .filter((x) => x === 0 || x === 1)
    : [];

  if (arr.length === 0) return null;

  const wins = arr.reduce((a, b) => a + (b === 1 ? 1 : 0), 0);
  const losses = arr.length - wins;

  // Special case: exactly 2 games and split results → neutral minus
  if (arr.length === 2 && wins === 1 && losses === 1) {
    return { sym: "–", cls: "elo-trend-neutral", title: "1 vinst / 1 förlust" };
  }

  // All wins / all losses
  if (wins === arr.length) {
    return { sym: "▲", cls: "elo-trend-up", title: `${wins} vinst${wins === 1 ? "" : "er"}` };
  }
  if (losses === arr.length) {
    return { sym: "▼", cls: "elo-trend-down", title: `${losses} förlust${losses === 1 ? "" : "er"}` };
  }

  // 3-game mixed trends
  if (arr.length === 3 && wins === 2) {
    return { sym: "▲", cls: "elo-trend-up-mid", title: "2 vinster / 1 förlust" };
  }
  if (arr.length === 3 && wins === 1) {
    return { sym: "▼", cls: "elo-trend-down-mid", title: "1 vinst / 2 förluster" };
  }

  // 1 game total
  if (arr.length === 1 && wins === 1) {
    return { sym: "▲", cls: "elo-trend-up", title: "Vinst" };
  }
  if (arr.length === 1 && losses === 1) {
    return { sym: "▼", cls: "elo-trend-down", title: "Förlust" };
  }

  return null;
}
const DIFFS = ["easy", "medium", "hard"];
const LB_VIEWS = ["easy", "medium", "hard", "total", "all"];

const SORT_KEYS = [
  { key: "score", label: "SCORE" },
  { key: "elo", label: "ELO" },
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

  // Online panel (visible for everyone)
  // NOTE: The server may attach extra admin-only stats under lobbyState.admin
  const isAdmin = session?.username === "Toffaboffa";
  const admin = lobbyState?.admin || null;
  const onlineUsers = Array.isArray(lobbyState?.onlineUsers)
    ? lobbyState.onlineUsers
    : Array.isArray(admin?.onlineUsers)
    ? admin.onlineUsers
    : [];

  // Hide guests defensively on the client too (server should already filter them).
  const visibleOnlineUsers = useMemo(() => {
    return (Array.isArray(onlineUsers) ? onlineUsers : []).filter(
      (u) => typeof u === "string" && !u.startsWith("__guest__")
    );
  }, [onlineUsers]);

  // --- Online privacy: "Hide me in the list" (persisted locally, applied server-side) ---
  const [hideMeOnline, setHideMeOnline] = useState(() => {
    try {
      return localStorage.getItem("geosense:hideOnline") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("geosense:hideOnline", hideMeOnline ? "1" : "0");
    } catch {
      // ignore
    }
  }, [hideMeOnline]);

  // Apply current preference to server whenever socket/session is ready.
  useEffect(() => {
    if (!socket || !session?.username) return;
    try {
      socket.emit("set_hide_online", { hide: !!hideMeOnline });
    } catch {
      // ignore
    }
  }, [socket, session?.username, hideMeOnline]);
  const adminStats = admin?.stats || {};
  const statLoggedInToday = Number(adminStats.loggedInToday) || 0;
  const statSoloToday = Number(adminStats.soloToday) || 0;
  const statPvpToday = Number(adminStats.pvpToday) || 0;
  const statTrialToday = Number(adminStats.trialToday) || 0;

  

  const handleLogout = () => {
    try {
      socket?.emit("logout");
    } catch {}
    onLogout?.();
  };
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
  const [lbSort, setLbSort] = useState("score"); // score|ppm|pct|sp|vm|fm
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
  const [aboutTab, setAboutTab] = useState("basic");


  // Feedback (Bug report / Feature request)
  const FEEDBACK_ADMIN_USERNAME = "Toffaboffa";
  const isFeedbackAdmin = session?.username === FEEDBACK_ADMIN_USERNAME;

  const [bugOpen, setBugOpen] = useState(false);
  const [bugMode, setBugMode] = useState("submit"); // "submit" | "admin"
  const [feedbackKind, setFeedbackKind] = useState("bug"); // "bug" | "feature"
  const [feedbackText, setFeedbackText] = useState("");

  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  // Admin listing
  const [feedbackFilter, setFeedbackFilter] = useState("all"); // "all" | "bug" | "feature"
  const [feedbackRows, setFeedbackRows] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSelectedId, setFeedbackSelectedId] = useState(null);


  // Lobby chat (försvinner efter 5 min)
  const CHAT_TTL_MS = 15 * 60 * 1000;
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
  // Handled centrally in App.jsx (styled modal + cleanup)

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

  const openAbout = () => {
    setAboutTab("basic");
    setAboutOpen(true);
  };

  const closeBug = () => setBugOpen(false);
  const openBug = async () => {
    setFeedbackError("");
    setFeedbackSent(false);
    setFeedbackSelectedId(null);

    const admin = isFeedbackAdmin;
    setBugMode(admin ? "admin" : "submit");
    setBugOpen(true);

    if (admin && session?.sessionId) {
      // Load latest feedback immediately
      try {
        setFeedbackLoading(true);
        setFeedbackRows([]);
        const res = await getFeedbackList(session.sessionId, { kind: null, limit: 200 });
        const rows = res?.rows || res?.data?.rows || res?.data || [];
        setFeedbackRows(Array.isArray(rows) ? rows : []);
      } catch (e) {
        setFeedbackError(e?.message || String(e));
      } finally {
        setFeedbackLoading(false);
      }
    }
  };

  const loadFeedbackList = async (filter = "all") => {
    if (!session?.sessionId) return;
    if (!isFeedbackAdmin) return;

    const kind = filter === "bug" || filter === "feature" ? filter : null;

    try {
      setFeedbackLoading(true);
      setFeedbackError("");
      const res = await getFeedbackList(session.sessionId, { kind, limit: 200 });
      const rows = res?.rows || res?.data?.rows || res?.data || [];
      setFeedbackRows(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setFeedbackError(e?.message || String(e));
    } finally {
      setFeedbackLoading(false);
    }
  };

  const submitFeedback = async () => {
    if (!session?.sessionId) return;
    if (feedbackSending) return;

    const kind = feedbackKind === "feature" ? "feature" : "bug";
    const message = String(feedbackText || "").trim();
    if (!message) {
      setFeedbackError(t("lobby.feedback.errorEmpty"));
      return;
    }

    setFeedbackSending(true);
    setFeedbackError("");
    setFeedbackSent(false);

    try {
      await createFeedback(session.sessionId, {
        kind,
        message,
        pageUrl: typeof window !== "undefined" ? window.location?.href : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        lang: typeof navigator !== "undefined" ? navigator.language : "",
        meta: {
          clientTime: new Date().toISOString(),
        },
      });

      setFeedbackText("");
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 1600);
    } catch (e) {
      setFeedbackError(e?.message || String(e));
    } finally {
      setFeedbackSending(false);
    }
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
    if (!socket) return;
    const targetUsername = String(challengeName || "").trim();
    if (!targetUsername) return;
    socket.emit("challenge_player", {
      targetUsername,
      difficulty: safeDiff(challengeDifficulty),
    });
    setChallengeName("");
  };

  // Challenge from lobby chat: click username
  const challengeFromChat = (username) => {
    if (!socket) return;
    const u = String(username || "").trim();
    if (!u) return;
    if (u === session?.username) return;
    socket.emit("challenge_player", {
      targetUsername: u,
      difficulty: safeDiff(challengeDifficulty),
    });
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

  const xpUi = useMemo(() => {
    const xpTotal = Number(progressData?.xp_total ?? progressData?.xpTotal ?? progressData?.xp ?? NaN);
    if (!Number.isFinite(xpTotal)) return null;

    // Prefer server-provided level/progress fields if present
    const lvlFromServer = Number(progressData?.level ?? NaN);
    const direct = {
      xpLevelBase: Number(progressData?.xpLevelBase ?? progressData?.xp_level_base ?? NaN),
      xpNextLevelAt: Number(progressData?.xpNextLevelAt ?? progressData?.xp_next_level_at ?? NaN),
      xpIntoLevel: Number(progressData?.xpIntoLevel ?? progressData?.xp_into_level ?? NaN),
      xpToNext: Number(progressData?.xpToNext ?? progressData?.xp_to_next ?? NaN),
      xpPctToNext: Number(progressData?.xpPctToNext ?? progressData?.xp_pct_to_next ?? NaN),
    };

    const hasDirect =
      Number.isFinite(direct.xpLevelBase) &&
      Number.isFinite(direct.xpNextLevelAt) &&
      Number.isFinite(direct.xpIntoLevel) &&
      Number.isFinite(direct.xpToNext) &&
      Number.isFinite(direct.xpPctToNext);

    if (hasDirect) {
      return {
        xpTotal,
        level: Number.isFinite(lvlFromServer) ? Math.max(0, Math.floor(lvlFromServer)) : null,
        ...direct,
      };
    }

    // Fallback: compute level/progress client-side from xp_total (same curve as server spec)
    const need = (L) => 180 + 40 * L + 6 * L * L;

    let level = 0;
    let base = 0;
    // Loop is cheap; levels won't be huge.
    while (xpTotal >= base + need(level)) {
      base += need(level);
      level += 1;
      if (level > 100000) break; // safety
    }

    const nextAt = base + need(level);
    const into = xpTotal - base;
    const toNext = Math.max(0, nextAt - xpTotal);
    const denom = Math.max(1, nextAt - base);
    const pct = Math.max(0, Math.min(100, (into / denom) * 100));

    return {
      xpTotal,
      level: Number.isFinite(lvlFromServer) ? Math.max(0, Math.floor(lvlFromServer)) : level,
      xpLevelBase: base,
      xpNextLevelAt: nextAt,
      xpIntoLevel: into,
      xpToNext: toNext,
      xpPctToNext: pct,
    };
  }, [progressData]);

  const levelValue =
    typeof progressData?.level === "number"
      ? progressData.level
      : typeof xpUi?.level === "number"
      ? xpUi.level
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
          <div className="adminPanel">
            <div className="chatHeader">{isAdmin ? "Admin: Online" : t("lobby.onlinePlayersTitle")}</div>

            {isAdmin && (
              <div className="adminStats">
                <div className="adminStatsRow">
                  <span className="adminStatsLabel">Inloggade idag</span>
                  <span className="adminStatsValue">{statLoggedInToday}</span>
                </div>
                <div className="adminStatsRow">
                  <span className="adminStatsLabel">Spelat solo</span>
                  <span className="adminStatsValue">{statSoloToday}</span>
                </div>
                <div className="adminStatsRow">
                  <span className="adminStatsLabel">Spelat match</span>
                  <span className="adminStatsValue">{statPvpToday}</span>
                </div>
                <div className="adminStatsRow">
                  <span className="adminStatsLabel">Spelat via Prova</span>
                  <span className="adminStatsValue">{statTrialToday}</span>
                </div>
              </div>
            )}

            <div className="onlineNowLine">{t("lobby.onlineNowCount", { n: onlineCount })}</div>

            <div className="adminList">
              {visibleOnlineUsers.length === 0 ? (
                <div className="adminEmpty">—</div>
              ) : (
                visibleOnlineUsers.map((u) => {
                  const isMe = u === session?.username;
                  return (
                    <div
                      key={u}
                      className={`adminUserRow ${isMe ? "is-me" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProgressFor(u)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openProgressFor(u);
                      }}
                      title={t("lobby.onlineClickToView")}
                    >
                      <span className="onlineDot" aria-hidden="true" />
                      <span className="adminUserName">{u}</span>

                      <span className="adminUserRowSpacer" aria-hidden="true" />

                      {/* Challenge icon (not for yourself) */}
                      {!isMe && (
                        <button
                          type="button"
                          className="onlineBattleBtn"
                          title={t("lobby.onlineChallenge")}
                          aria-label={t("lobby.onlineChallenge")}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            challengeFromChat(u);
                          }}
                        >
                          ⚔️
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="onlinePrivacyRow">
              <button
                type="button"
                className={`onlinePrivacyBtn ${hideMeOnline ? "is-on" : ""}`}
                onClick={() => setHideMeOnline((v) => !v)}
                title={t("lobby.onlineHideMeTitle")}
              >
                {hideMeOnline ? t("lobby.onlineShowMe") : t("lobby.onlineHideMe")}
              </button>
            </div>
          </div>

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
              <button className="logout-btn" onClick={handleLogout}>
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

          {/* Online count is shown in the left online panel (same for all users). */}

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

            {/*
              We only gate on socket availability.
              Some browsers/devices have edge-cases where the controlled input value
              and the disabled-state can desync after certain flows, making the button
              look "stuck" disabled. The submit handler still guards against empty input.
            */}
            <button type="submit" disabled={!socket}>
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
                      <button
                        type="button"
                        className="lobby-chat-user lobby-chat-user-btn"
                        onClick={() => challengeFromChat(m.user)}
                        disabled={!socket || String(m.user || "").trim() === session?.username}
                      >
                        {m.user}
                        {Number.isFinite(Number(m.level)) ? ` · L${Number(m.level)}` : ""}
                      </button>
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
            <div className="muted" style={{ textAlign: "center", marginTop: 6 }}>
              {t("lobby.leaderboardMinMatchesHint")}
            </div>

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

						<th className="lb-score-head" rowSpan={2}>
						  SCORE
						</th>
						<th className="lb-elo-head" rowSpan={2}>
						  ELO
						</th>
						</tr>

                        <tr>
                          <th className="lb-rank">#</th>
                          <th className="lb-name">{t("lobby.lb.player")}</th>
                          <th className="lb-lvl">LVL</th>

                          {groupsToShow.includes("easy") && (
                            <>
                              <th className="lb-sub lb-easy lb-gstart">SM</th>
                              <th className="lb-sub lb-easy">VM</th>
                              <th className="lb-sub lb-easy">FM</th>
                              <th className="lb-sub lb-easy">PCT</th>
                              <th className="lb-sub lb-easy">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("medium") && (
                            <>
                              <th className="lb-sub lb-medium lb-gstart">SM</th>
                              <th className="lb-sub lb-medium">VM</th>
                              <th className="lb-sub lb-medium">FM</th>
                              <th className="lb-sub lb-medium">PCT</th>
                              <th className="lb-sub lb-medium">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("hard") && (
                            <>
                              <th className="lb-sub lb-hard lb-gstart">SM</th>
                              <th className="lb-sub lb-hard">VM</th>
                              <th className="lb-sub lb-hard">FM</th>
                              <th className="lb-sub lb-hard">PCT</th>
                              <th className="lb-sub lb-hard">PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("total") && (
                            <>
                              <th className="lb-sub lb-total lb-gstart">SM</th>
                              <th className="lb-sub lb-total">VM</th>
                              <th className="lb-sub lb-total">FM</th>
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

                          <th className="lb-score-head" rowSpan={2}>
                            SCORE
                          </th>
						  <th className="lb-elo-head" rowSpan={2}>
						    ELO
						  </th>
                        </tr>

                        <tr>
                          <th className="lb-rank" />
                          <th />
                          <th className="lb-lvl" />

                          {groupsToShow.includes("easy") && (
                            <>
                              <th>SM</th>
                              <th>VM</th>
                              <th>FM</th>
                              <th>PCT</th>
                              <th>PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("medium") && (
                            <>
                              <th>SM</th>
                              <th>VM</th>
                              <th>FM</th>
                              <th>PCT</th>
                              <th>PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("hard") && (
                            <>
                              <th>SM</th>
                              <th>VM</th>
                              <th>FM</th>
                              <th>PCT</th>
                              <th>PPM</th>
                            </>
                          )}
                          {groupsToShow.includes("total") && (
                            <>
                              <th>SM</th>
                              <th>VM</th>
                              <th>FM</th>
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
                              <td>{getCell(u, "e_", "sp")}</td>
                              <td>{getCell(u, "e_", "vm")}</td>
                              <td>{getCell(u, "e_", "fm")}</td>
                              <td>{getCell(u, "e_", "pct")}</td>
                              <td>{getCell(u, "e_", "ppm")}</td>
                            </>
                          )}

                          {groupsToShow.includes("medium") && (
                            <>
                              <td>{getCell(u, "m_", "sp")}</td>
                              <td>{getCell(u, "m_", "vm")}</td>
                              <td>{getCell(u, "m_", "fm")}</td>
                              <td>{getCell(u, "m_", "pct")}</td>
                              <td>{getCell(u, "m_", "ppm")}</td>
                            </>
                          )}

                          {groupsToShow.includes("hard") && (
                            <>
                              <td>{getCell(u, "s_", "sp")}</td>
                              <td>{getCell(u, "s_", "vm")}</td>
                              <td>{getCell(u, "s_", "fm")}</td>
                              <td>{getCell(u, "s_", "pct")}</td>
                              <td>{getCell(u, "s_", "ppm")}</td>
                            </>
                          )}

                          {groupsToShow.includes("total") && (
                            <>
                              <td>{getCell(u, "t_", "sp")}</td>
                              <td>{getCell(u, "t_", "vm")}</td>
                              <td>{getCell(u, "t_", "fm")}</td>
                              <td>{getCell(u, "t_", "pct")}</td>
                              <td>{getCell(u, "t_", "ppm")}</td>
                            </>
                          )}

							<td className="lb-score">{fmtIntOrDash(u?.score)}</td>
							<td className="lb-elo">
                              <span className="elo-value">{fmtIntOrDash(u?.elo_rating)}</span>
                              {(() => {
                                const meta = eloTrendMeta(u?.elo_recent);
                                if (!meta) return null;
                                return (
                                  <span
                                    className={`elo-trend ${meta.cls}`}
                                    title={meta.title}
                                    aria-label={meta.title}
                                  >
                                    {meta.sym}
                                  </span>
                                );
                              })()}
                            </td>
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

<div className="feedback-tabs">
  <button
    type="button"
    className={`feedback-tab ${aboutTab === "basic" ? "active" : ""}`}
    onClick={() => setAboutTab("basic")}
  >
    {t("lobby.aboutTabs.basic")}
  </button>
  <button
    type="button"
    className={`feedback-tab ${aboutTab === "scoring" ? "active" : ""}`}
    onClick={() => setAboutTab("scoring")}
  >
    {t("lobby.aboutTabs.scoring")}
  </button>
  <button
    type="button"
    className={`feedback-tab ${aboutTab === "xp" ? "active" : ""}`}
    onClick={() => setAboutTab("xp")}
  >
    {t("lobby.aboutTabs.xp")}
  </button>
  <button
    type="button"
    className={`feedback-tab ${aboutTab === "leaderboard" ? "active" : ""}`}
    onClick={() => setAboutTab("leaderboard")}
  >
    {t("lobby.aboutTabs.leaderboard")}
  </button>
</div>

{aboutTab === "basic" && (
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
            )}

{aboutTab === "scoring" && (
  <div className="about-content">
    <p>{t("lobby.aboutScoring.p1")}</p>
    <p>{t("lobby.aboutScoring.p2")}</p>

    <h3>{t("lobby.aboutScoring.hFormula")}</h3>
    <div>
      {String(t("lobby.aboutScoring.formula") || "")
        .split("\n")
        .map((line, i) => (
          <div key={i}>
            <code>{line}</code>
          </div>
        ))}
    </div>

    <h3>{t("lobby.aboutScoring.hExamples")}</h3>
    <p>{t("lobby.aboutScoring.ex1")}</p>
    <p>{t("lobby.aboutScoring.ex2")}</p>
    <p>{t("lobby.aboutScoring.ex3")}</p>
  </div>
)}

{aboutTab === "xp" && (
  <div className="about-content">
    <p>{t("lobby.aboutXp.p1")}</p>

    <h3>{t("lobby.aboutXp.hBreakdown")}</h3>
    <p>{t("lobby.aboutXp.p2")}</p>
    <p>{t("lobby.aboutXp.p3")}</p>
    <p>{t("lobby.aboutXp.p4")}</p>

    <h3>{t("lobby.aboutXp.hBadges")}</h3>
    <p>{t("lobby.aboutXp.p5")}</p>
  </div>
)}

{aboutTab === "leaderboard" && (
  <div className="about-content">
    <p>{t("lobby.aboutLeaderboard.p1")}</p>

<h3>{t("lobby.aboutLeaderboard.hColumns")}</h3>
<div>
  <div><code>LVL</code> — {t("lobby.aboutLeaderboard.colLvl")}</div>
  <div><code>SM</code> — {t("lobby.aboutLeaderboard.colSm")}</div>
  <div><code>VM</code> — {t("lobby.aboutLeaderboard.colVm")}</div>
  <div><code>FM</code> — {t("lobby.aboutLeaderboard.colFm")}</div>
  <div><code>PCT</code> — {t("lobby.aboutLeaderboard.colPct")}</div>
  <div><code>PPM</code> — {t("lobby.aboutLeaderboard.colPpm")}</div>
  <div><code>SCORE</code> — {t("lobby.aboutLeaderboard.colScore")}</div>
  <div><code>ELO</code> — {t("lobby.aboutLeaderboard.colElo")}</div>
</div>

<h3>{t("lobby.aboutLeaderboard.hScore")}</h3>
<p>{t("lobby.aboutLeaderboard.p2")}</p>
<p>{t("lobby.aboutLeaderboard.p3")}</p>
<p>{t("lobby.aboutLeaderboard.p4")}</p>

<h3>{t("lobby.aboutLeaderboard.hElo")}</h3>
<p>{t("lobby.aboutLeaderboard.pElo1")}</p>
<p>{t("lobby.aboutLeaderboard.pElo2")}</p>
<p>{t("lobby.aboutLeaderboard.pElo3")}</p>

<h3>{t("lobby.aboutLeaderboard.hNotes")}</h3>
<p>{t("lobby.aboutLeaderboard.p5")}</p>
</div>
)}

            <div className="finish-actions">
              <button className="hud-btn" onClick={closeAbout}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback modal */}
      {bugOpen && (
        <div className="finish-overlay" onClick={closeBug}>
          <div className="finish-card finish-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finish-title">
              {bugMode === "admin" ? t("lobby.feedback.adminTitle") : t("lobby.feedback.title")}
            </div>

            {bugMode !== "admin" && (
              <div className="about-content">
                <div className="feedback-tabs">
                  <button
                    type="button"
                    className={`feedback-tab ${feedbackKind === "bug" ? "active" : ""}`}
                    onClick={() => setFeedbackKind("bug")}
                  >
                    🐞 {t("lobby.feedback.kindBug")}
                  </button>
                  <button
                    type="button"
                    className={`feedback-tab ${feedbackKind === "feature" ? "active" : ""}`}
                    onClick={() => setFeedbackKind("feature")}
                  >
                    ✨ {t("lobby.feedback.kindFeature")}
                  </button>
                </div>

                <textarea
                  className="bug-report-text"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={
                    feedbackKind === "feature"
                      ? t("lobby.feedback.placeholderFeature")
                      : t("lobby.feedback.placeholderBug")
                  }
                />

                {feedbackError && <div className="progress-error">{feedbackError}</div>}
                {feedbackSent && <div className="feedback-ok">✅ {t("lobby.feedback.sent")}</div>}

                <div className="bug-report-actions">
                  <button
                    type="button"
                    className="hud-btn"
                    onClick={submitFeedback}
                    disabled={feedbackSending || !feedbackText.trim()}
                  >
                    {feedbackSending ? t("lobby.feedback.sending") : t("lobby.feedback.send")}
                  </button>
                  <button type="button" className="hud-btn" onClick={closeBug}>
                    {t("common.close")}
                  </button>
                </div>
              </div>
            )}

            {bugMode === "admin" && (
              <div className="about-content">
                <div className="feedback-admin-top">
                  <div className="feedback-tabs">
                    <button
                      type="button"
                      className={`feedback-tab ${feedbackFilter === "all" ? "active" : ""}`}
                      onClick={() => {
                        setFeedbackFilter("all");
                        loadFeedbackList("all");
                      }}
                    >
                      {t("lobby.feedback.filterAll")}
                    </button>
                    <button
                      type="button"
                      className={`feedback-tab ${feedbackFilter === "bug" ? "active" : ""}`}
                      onClick={() => {
                        setFeedbackFilter("bug");
                        loadFeedbackList("bug");
                      }}
                    >
                      {t("lobby.feedback.filterBug")}
                    </button>
                    <button
                      type="button"
                      className={`feedback-tab ${feedbackFilter === "feature" ? "active" : ""}`}
                      onClick={() => {
                        setFeedbackFilter("feature");
                        loadFeedbackList("feature");
                      }}
                    >
                      {t("lobby.feedback.filterFeature")}
                    </button>
                  </div>

                  <button type="button" className="hud-btn" onClick={() => loadFeedbackList(feedbackFilter)}>
                    ↻ {t("lobby.feedback.refresh")}
                  </button>
                </div>

                {feedbackLoading && <div className="progress-loading">{t("common.loading")}</div>}
                {feedbackError && <div className="progress-error">{feedbackError}</div>}

                {!feedbackLoading && !feedbackError && (
                  <>
                    {(!feedbackRows || feedbackRows.length === 0) ? (
                      <div className="about-content">{t("lobby.feedback.empty")}</div>
                    ) : (
                      <table className="leaderboard leaderboard-wide feedback-table">
                        <thead>
                          <tr>
                            <th style={{ width: 140 }}>{t("lobby.feedback.colTime")}</th>
                            <th style={{ width: 110 }}>{t("lobby.feedback.colKind")}</th>
                            <th style={{ width: 140 }}>{t("lobby.feedback.colUser")}</th>
                            <th>{t("lobby.feedback.colMessage")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {feedbackRows.map((r) => {
                            const isSel = feedbackSelectedId === r.id;
                            const msg = String(r.message || "");
                            const short = msg.length > 90 ? `${msg.slice(0, 90)}…` : msg;
                            const time = r.created_at ? new Date(r.created_at).toLocaleString() : "";
                            return (
                              <React.Fragment key={r.id}>
                                <tr
                                  className={isSel ? "is-me" : ""}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => setFeedbackSelectedId(isSel ? null : r.id)}
                                >
                                  <td>{time}</td>
                                  <td>{r.kind}</td>
                                  <td>{r.username}</td>
                                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 420 }}>
                                    {short}
                                  </td>
                                </tr>

                                {isSel && (
                                  <tr>
                                    <td colSpan={4} className="feedback-details">
                                      <div className="feedback-details-msg">{msg}</div>
                                      {r.page_url && (
                                        <div className="feedback-details-meta">
                                          <span className="muted">{t("lobby.feedback.colUrl")}: </span>
                                          <span className="mono">{r.page_url}</span>
                                        </div>
                                      )}
                                      {r.lang && (
                                        <div className="feedback-details-meta">
                                          <span className="muted">{t("lobby.feedback.colLang")}: </span>
                                          <span className="mono">{r.lang}</span>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </>
                )}

                <div className="bug-report-actions">
                  <button type="button" className="hud-btn" onClick={closeBug}>
                    {t("common.close")}
                  </button>
                </div>
              </div>
            )}
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
                  {xpUi && (
                    <div className="progress-xp">
                      <div className="progress-xp-row">
                        <div className="ps-label">{t("common.xp")}</div>
                        <div className="ps-value">{fmtIntOrDash(xpUi.xpTotal)}</div>
                      </div>

                      <div
                        className="xp-bar"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(Number(xpUi.xpPctToNext ?? 0))}
                      >
                        <div className="xp-bar-fill" style={{ width: `${xpUi.xpPctToNext}%` }} />
                      </div>

                      <div className="xp-subtext">
                        {t("lobby.progress.xpToNext", { n: fmtIntOrDash(xpUi.xpToNext) })}
                      </div>
                    </div>
                  )}

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

