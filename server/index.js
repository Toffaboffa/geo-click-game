// server/index.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import argon2 from "argon2";
import crypto from "crypto";
import { cities } from "./cities.js";
import { haversineDistanceKm, createRoundScorer } from "./gameLogic.js";
import {
  getBadgesCatalogWithCriteria,
  mapBadgesByCode,
  evaluateEligibleBadgeCodes,
} from "./badgesEngine.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json());

// =====================
// Config
// =====================
const BOT_NAME = "__BOT__";
const LEADERBOARD_LIMIT = 20;

const DIFFICULTIES = ["easy", "medium", "hard"];
const DEFAULT_DIFFICULTY = "medium";

// City pool rules
const EASY_POP_MIN = 1_000_000; // Easy: capitals + >= 1M
const MEDIUM_POP_MIN = 200_000; // Medium: Easy + >= 200k

function normalizeDifficulty(d) {
  const v = String(d || "").trim().toLowerCase();
  if (DIFFICULTIES.includes(v)) return v;
  return DEFAULT_DIFFICULTY;
}

function diffCols(difficulty) {
  const d = normalizeDifficulty(difficulty);
  if (d === "easy") {
    return {
      played: "easy_played",
      wins: "easy_wins",
      losses: "easy_losses",
      totalScore: "easy_total_score",
    };
  }
  if (d === "hard") {
    return {
      played: "hard_played",
      wins: "hard_wins",
      losses: "hard_losses",
      totalScore: "hard_total_score",
    };
  }
  // medium default
  return {
    played: "medium_played",
    wins: "medium_wins",
    losses: "medium_losses",
    totalScore: "medium_total_score",
  };
}

// Match/round timing
const ROUND_TIMEOUT_MS = 20_000; // efter 20s: auto-result + vidare
const PENALTY_TIME_MS = 20_000; // om man inte klickar: timeMs som max

// Score normalization
const SCORER_MAX_TIME_MS = 20_000; // normalisera tid i score över 20s
const SCORER_MAX_DISTANCE_KM = 20_000;

// Start-ready gate timers
const START_READY_PROMPT_DELAY_MS = 200;
const START_READY_AUTO_START_MS = 12_000;

// Walkover policy (Variant X)
const WALKOVER_LOSER_SCORE = 15_000; // totalpoäng för 10 rundor ~ max 20k
const DISCONNECT_GRACE_MS = 10_000;

// Sweep policy (1B)
const MATCH_SWEEP_INTERVAL_MS = 60_000;
const MATCH_FINISHED_TTL_MS = 2 * 60_000; // behåll färdiga matcher 2 min
const MATCH_MAX_AGE_MS = 30 * 60_000; // failsafe: 30 min
const CHALLENGE_TTL_MS = 45_000;

// =====================
// Helpers (auth/sessions)
// =====================
function hashPassword(pw) {
  // Legacy (kept for backwards-compat migration on login)
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function isLegacySha256Hash(stored) {
  return typeof stored === "string" && /^[a-f0-9]{64}$/i.test(stored);
}

async function hashPasswordModern(pw) {
  // Argon2id is the current best-practice for password hashing
  return argon2.hash(pw, { type: argon2.argon2id });
}

async function verifyPassword(pw, storedHash) {
  if (isLegacySha256Hash(storedHash)) {
    return hashPassword(pw) === storedHash;
  }
  return argon2.verify(storedHash, pw);
}

// Rate limit auth endpoints (helps against brute-force & spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
});

function sessionTtlMs() {
  const days = Number(process.env.SESSION_TTL_DAYS || 30);
  return days * 24 * 60 * 60 * 1000;
}
async function createSession(username) {
  const id = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await pool.query("insert into sessions (id, username, expires_at) values ($1, $2, $3)", [
    id,
    username,
    expiresAt,
  ]);
  return id;
}
async function getUsernameFromSession(sessionId) {
  const now = new Date();
  const { rows } = await pool.query("select username from sessions where id=$1 and expires_at > $2", [
    sessionId,
    now,
  ]);
  return rows[0]?.username ?? null;
}

setInterval(() => {
  pool.query("delete from sessions where expires_at <= now()").catch(() => {});
}, 60_000).unref?.();

async function authMiddleware(req, res, next) {
  try {
    const sid = req.headers["x-session-id"];
    if (!sid) return res.status(401).json({ error: "Inte inloggad" });
    const username = await getUsernameFromSession(sid);
    if (!username) return res.status(401).json({ error: "Inte inloggad" });
    req.username = username;
    req.sessionId = sid;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
}

// =====================
// DB helpers: kolumn-existens (för kompat)
// =====================
const _colCache = new Map(); // "table.column" -> boolean
async function hasColumn(dbClient, table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);

  const { rows } = await dbClient.query(
    `select 1
     from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name=$2
     limit 1`,
    [table, column]
  );
  const ok = rows.length > 0;
  _colCache.set(key, ok);
  return ok;
}

function pickExistingCols(existingMap, cols) {
  return cols.filter((c) => existingMap.get(c) === true);
}

// =====================
// Basic routes
// =====================
app.get("/api/me", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    // Basfält (bör finnas)
    const baseCols = ["username", "played", "wins", "losses", "total_score", "avg_score", "pct"];

    // Optional/nya fält
    const optionalCols = [
      "level",
      "badges_count",
      "win_streak",
      "best_win_streak",
      "best_match_score",
      "played_challenges_total",
      "wins_challenges_total",
      "started_matches_via_queue",
      "best_win_margin",
      "hidden",
    ];

    const exists = new Map();
    for (const c of optionalCols) {
      // username etc behöver vi inte checka
      exists.set(c, await hasColumn(client, "users", c));
    }

    const selectedOptional = pickExistingCols(exists, optionalCols);
    const selectCols = [...baseCols, ...selectedOptional];

    const { rows } = await client.query(
      `select ${selectCols.join(", ")}
       from users
       where username = $1`,
      [req.username]
    );

    const me = rows[0] || null;
    if (me && Object.prototype.hasOwnProperty.call(me, "hidden")) {
      const hidden = !!me.hidden;
      me.showOnLeaderboard = !hidden;
    }

    res.json(me);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ error: "Saknar användarnamn/lösen" });

    // Store modern password hash (argon2id)
    const password_hash = await hashPasswordModern(password);
    await pool.query("insert into users (username, password_hash) values ($1, $2)", [
      username,
      password_hash,
    ]);

    const sessionId = await createSession(username);
    res.json({ sessionId, username });
  } catch (e) {
    if (String(e?.message || "").includes("duplicate key")) {
      return res.status(409).json({ error: "Användarnamn finns redan" });
    }
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ error: "Saknar användarnamn/lösen" });

    const { rows } = await pool.query("select username, password_hash from users where username=$1", [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Fel användarnamn eller lösenord" });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Fel användarnamn eller lösenord" });

    // One-time migration: upgrade legacy sha256 hashes to argon2id on successful login
    if (isLegacySha256Hash(user.password_hash)) {
      const upgraded = await hashPasswordModern(password);
      await pool.query("update users set password_hash=$1 where username=$2", [upgraded, username]);
    }

    const sessionId = await createSession(username);
    res.json({ sessionId, username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

app.post("/api/logout", authMiddleware, async (req, res) => {
  try {
    await pool.query("delete from sessions where id=$1", [req.sessionId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// ✅ Sätt visibility: ny route som klienten använder
app.patch("/api/me/leaderboard-visibility", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const okHidden = await hasColumn(client, "users", "hidden");
    if (!okHidden) return res.status(400).json({ error: "Kolumnen 'hidden' saknas i users" });

    const showOnLeaderboard = !!req.body?.showOnLeaderboard;
    const hidden = !showOnLeaderboard;

    await client.query(`update users set hidden = $2 where username = $1`, [req.username, hidden]);

    res.json({ ok: true, showOnLeaderboard, hidden });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

// ✅ Legacy/fallback (om du råkar ha gamla klienter)
app.post("/api/me/visibility", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const okHidden = await hasColumn(client, "users", "hidden");
    if (!okHidden) return res.status(400).json({ error: "Kolumnen 'hidden' saknas i users" });

    const hidden = !!req.body?.hidden;
    await client.query(`update users set hidden = $2 where username = $1`, [req.username, hidden]);
    res.json({ ok: true, hidden, showOnLeaderboard: !hidden });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

// ✅ Badges catalog (klienten använder den)
app.get("/api/badges", authMiddleware, async (_req, res) => {
  try {
    const badges = await getBadgesCatalogWithCriteria(pool);
    // Vi skickar “rena” badge-defs till klienten
    res.json(
      (Array.isArray(badges) ? badges : []).map((b) => ({
        code: b.code,
        name: b.name,
        description: b.description,
        emoji: b.emoji,
        groupKey: b.groupKey,
        groupName: b.groupName,
        sortInGroup: b.sortInGroup,
        iconUrl: b.iconUrl,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// ✅ Progression: “jag”
app.get("/api/me/progression", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const username = req.username;

    const optional = ["level", "badges_count", "best_match_score",
      "played_challenges_total",
      "wins_challenges_total",
      "started_matches_via_queue", "best_win_margin"];
    const exists = new Map();
    for (const c of optional) exists.set(c, await hasColumn(client, "users", c));

    const selectCols = [
      "username",
      "played",
      "wins",
      "losses",
      "avg_score",
      "pct",
      ...pickExistingCols(exists, optional),
    ];

    const { rows } = await client.query(`select ${selectCols.join(", ")} from users where username = $1`, [
      username,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Hittade inte användare" });

    const u = rows[0];

    const { rows: earned } = await client.query(
      `select badge_code, earned_at, match_id, meta
       from public.user_badges
       where username = $1
       order by earned_at asc`,
      [username]
    );

    res.json({
      username,
      level: typeof u.level === "number" ? u.level : null,
      badges_count: typeof u.badges_count === "number" ? u.badges_count : null,
      badgesCount: typeof u.badges_count === "number" ? u.badges_count : null, // extra kompat
      earnedBadges: earned,
      stats: {
        played: u.played ?? 0,
        wins: u.wins ?? 0,
        losses: u.losses ?? 0,
        avgScore: u.avg_score ?? null,
        pct: u.pct ?? null,
        bestMatchScore: Object.prototype.hasOwnProperty.call(u, "best_match_score") ? u.best_match_score : null,
        bestWinMargin: Object.prototype.hasOwnProperty.call(u, "best_win_margin") ? u.best_win_margin : null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

// ✅ Progression: annan användare
app.get("/api/users/:username/progression", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "Saknar username" });

    const optional = ["level", "badges_count", "best_match_score",
      "played_challenges_total",
      "wins_challenges_total",
      "started_matches_via_queue", "best_win_margin"];
    const exists = new Map();
    for (const c of optional) exists.set(c, await hasColumn(client, "users", c));

    const selectCols = [
      "username",
      "played",
      "wins",
      "losses",
      "avg_score",
      "pct",
      ...pickExistingCols(exists, optional),
    ];

    const { rows } = await client.query(`select ${selectCols.join(", ")} from users where username = $1`, [
      username,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Hittade inte användare" });

    const u = rows[0];

    const { rows: earned } = await client.query(
      `select badge_code, earned_at, match_id, meta
       from public.user_badges
       where username = $1
       order by earned_at asc`,
      [username]
    );

    res.json({
      username,
      level: typeof u.level === "number" ? u.level : null,
      badges_count: typeof u.badges_count === "number" ? u.badges_count : null,
      badgesCount: typeof u.badges_count === "number" ? u.badges_count : null,
      earnedBadges: earned,
      stats: {
        played: u.played ?? 0,
        wins: u.wins ?? 0,
        losses: u.losses ?? 0,
        avgScore: u.avg_score ?? null,
        pct: u.pct ?? null,
        bestMatchScore: Object.prototype.hasOwnProperty.call(u, "best_match_score") ? u.best_match_score : null,
        bestWinMargin: Object.prototype.hasOwnProperty.call(u, "best_win_margin") ? u.best_win_margin : null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

// Legacy leaderboard (behåll för bakåtkompat)
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select username, played, wins, losses, total_score, avg_score, pct, level, badges_count, win_streak, best_win_streak
       from users
       where hidden = false
       order by avg_score asc nulls last, played desc
       limit $1`,
      [LEADERBOARD_LIMIT]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// ✅ NEW: Wide leaderboard (easy/medium/hard/total) från public.leaderboard_wide
app.get("/api/leaderboard-wide", async (req, res) => {
  try {
    const mode = normalizeDifficulty(req.query.mode || "total");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50) || 50));

    // total är inte en difficulty i normalizeDifficulty, så special-case:
    const modeKey = String(req.query.mode || "total").trim().toLowerCase() === "total" ? "total" : mode;

    const prefix = modeKey === "easy" ? "e_" : modeKey === "medium" ? "m_" : modeKey === "hard" ? "s_" : "t_";

    const sortRaw = String(req.query.sort || "ppm").trim().toLowerCase();
    const dirRaw = String(req.query.dir || "").trim().toLowerCase();

    const allowedSort = new Set(["ppm", "pct", "sp", "vm", "fm"]);
    const sort = allowedSort.has(sortRaw) ? sortRaw : "ppm";

    // Default direction per sort
    const defaultDir = sort === "pct" || sort === "vm" ? "desc" : "asc";
    const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir;

    const col = `${prefix}${sort}`;
    const playedCol = `${prefix}sp`;

    const allowedCols = new Set([
      "e_ppm",
      "e_pct",
      "e_sp",
      "e_vm",
      "e_fm",
      "m_ppm",
      "m_pct",
      "m_sp",
      "m_vm",
      "m_fm",
      "s_ppm",
      "s_pct",
      "s_sp",
      "s_vm",
      "s_fm",
      "t_ppm",
      "t_pct",
      "t_sp",
      "t_vm",
      "t_fm",
    ]);
    if (!allowedCols.has(col) || !allowedCols.has(playedCol)) {
      return res.status(400).json({ error: "Ogiltiga sort-parametrar" });
    }

    const { rows } = await pool.query(
      `select *
       from public.leaderboard_wide
       where coalesce(hidden,false) = false
         and ${playedCol} > 0
       order by
         ${col} ${dir} nulls last,
         ${prefix}pct desc nulls last,
         ${playedCol} desc,
         namn asc
       limit $1`,
      [limit]
    );

    res.json({ mode: modeKey, sort, dir, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// =====================
// Lobby & matchning (Socket.io)
// =====================
const lobby = {
  onlineUsers: new Set(),
  queues: {
    easy: new Set(),
    medium: new Set(),
    hard: new Set(),
  },
};

const socketsByUser = new Map(); // username -> socket.id
const matches = new Map(); // matchId -> match

const activeMatchByUser = new Map(); // username -> matchId
const disconnectGrace = new Map(); // username -> timeoutId
const pendingChallengesById = new Map(); // challengeId -> { id, from, to, difficulty, expiresAt }
const pendingChallengeByPair = new Map(); // `${from}->${to}` -> challengeId

function getRoomName(matchId) {
  return `match_${matchId}`;
}

function nowMs() {
  return Date.now();
}

function getQueueCounts() {
  return {
    easy: lobby.queues.easy.size,
    medium: lobby.queues.medium.size,
    hard: lobby.queues.hard.size,
  };
}

function removeUserFromAllQueues(username) {
  for (const d of DIFFICULTIES) lobby.queues[d].delete(username);
}

function broadcastLobby() {
  io.emit("lobby_state", { onlineCount: lobby.onlineUsers.size, queueCounts: getQueueCounts() });
}

function isUserInActiveMatch(username) {
  return activeMatchByUser.has(username);
}

function clearDisconnectGrace(username) {
  const t = disconnectGrace.get(username);
  if (t) clearTimeout(t);
  disconnectGrace.delete(username);
}

function createMatch(playerA, playerB, opts = {}) {
  const matchId = crypto.randomBytes(8).toString("hex");
  const scorer = createRoundScorer(SCORER_MAX_DISTANCE_KM, SCORER_MAX_TIME_MS);
  const match = {
    id: matchId,
    createdAt: nowMs(),
    finishedAt: null,
    finishReason: null,
    players: [playerA, playerB],
    currentRound: 0,
    totalRounds: 10,
    rounds: [],
    finished: false,
    scorer,
    isSolo: !!opts.isSolo,
    isPractice: !!opts.isPractice,
    difficulty: normalizeDifficulty(opts.difficulty),
    source: opts.source || (opts.isSolo ? "solo" : "queue"),

    // start-ready gate
    awaitingStartReady: true,
    startReady: new Set(),
    startReadyPromptTimeout: null,
    startReadyTimeout: null,

    // between-round gate
    awaitingReady: false,
    ready: new Set(),
    readyPromptTimeout: null,
    readyTimeout: null,

    countdownTimeout: null,
    roundTimeout: null,
  };
  matches.set(matchId, match);
  return match;
}

function tryMatchQueue(difficulty) {
  const d = normalizeDifficulty(difficulty);
  const q = lobby.queues[d];
  if (!q || q.size < 2) return;

  while (q.size >= 2) {
    const queue = Array.from(q);
    let a = null;
    let b = null;

    for (const u of queue) {
      if (!lobby.onlineUsers.has(u)) {
        q.delete(u);
        continue;
      }
      if (isUserInActiveMatch(u)) {
        q.delete(u);
        continue;
      }
      if (!a) a = u;
      else if (!b) {
        b = u;
        break;
      }
    }

    if (!a || !b) return;

    q.delete(a);
    q.delete(b);

    const match = createMatch(a, b, { difficulty: d, source: "queue" });
    startMatch(match);
  }
}

function tryMatchAllQueues() {
  tryMatchQueue("easy");
  tryMatchQueue("medium");
  tryMatchQueue("hard");
}

function clearStartReady(match) {
  match.awaitingStartReady = false;
  clearTimeout(match.startReadyPromptTimeout);
  clearTimeout(match.startReadyTimeout);
  match.startReadyPromptTimeout = null;
  match.startReadyTimeout = null;
  match.startReady.clear();
}

function setActiveMatchForPlayers(match) {
  const [pA, pB] = match.players;
  if (pA !== BOT_NAME) activeMatchByUser.set(pA, match.id);
  if (pB !== BOT_NAME) activeMatchByUser.set(pB, match.id);
}
function clearActiveMatchForPlayers(match) {
  const [pA, pB] = match.players;
  if (pA !== BOT_NAME) activeMatchByUser.delete(pA);
  if (pB !== BOT_NAME) activeMatchByUser.delete(pB);
}

function clearAllMatchTimers(match) {
  if (!match) return;
  clearTimeout(match.startReadyPromptTimeout);
  clearTimeout(match.startReadyTimeout);
  clearTimeout(match.readyPromptTimeout);
  clearTimeout(match.readyTimeout);
  clearTimeout(match.countdownTimeout);
  clearTimeout(match.roundTimeout);
  match.startReadyPromptTimeout = null;
  match.startReadyTimeout = null;
  match.readyPromptTimeout = null;
  match.readyTimeout = null;
  match.countdownTimeout = null;
  match.roundTimeout = null;
}

function startMatch(match) {
  const [pA, pB] = match.players;

  removeUserFromAllQueues(pA);
  removeUserFromAllQueues(pB);
  broadcastLobby();

  setActiveMatchForPlayers(match);

  const room = getRoomName(match.id);

  const sA = socketsByUser.get(pA);
  const sB = socketsByUser.get(pB);
  if (sA) io.sockets.sockets.get(sA)?.join(room);
  if (sB) io.sockets.sockets.get(sB)?.join(room);

  io.to(room).emit("match_started", {
    matchId: match.id,
    players: match.players,
    totalRounds: match.totalRounds,
    isSolo: false,
    isPractice: false,
    difficulty: match.difficulty,
  });

  match.awaitingStartReady = true;
  match.startReady.clear();

  match.startReadyPromptTimeout = setTimeout(() => {
    io.to(room).emit("start_ready_prompt");
  }, START_READY_PROMPT_DELAY_MS);

  match.startReadyTimeout = setTimeout(() => {
    clearStartReady(match);
    startRound(match);
  }, START_READY_AUTO_START_MS);
}

function startSoloMatch(match, socket) {
  removeUserFromAllQueues(match.players[0]);
  broadcastLobby();

  const room = getRoomName(match.id);
  socket.join(room);

  setActiveMatchForPlayers(match);

  io.to(room).emit("match_started", {
    matchId: match.id,
    players: match.players,
    totalRounds: match.totalRounds,
    isSolo: true,
    isPractice: !!match.isPractice,
    difficulty: match.difficulty,
  });

  match.awaitingStartReady = true;
  match.startReady.clear();

  match.startReadyPromptTimeout = setTimeout(() => {
    io.to(room).emit("start_ready_prompt");
  }, START_READY_PROMPT_DELAY_MS);

  match.startReadyTimeout = setTimeout(() => {
    clearStartReady(match);
    startRound(match);
  }, 10_000);
}

function calculateClick(city, lon, lat, timeMs, scorer) {
  // Coerce till numbers och clampa tid (skyddar mot strängar / negativa värden)
  const cLat = Number(city?.lat);
  const cLon = Number(city?.lon);

  const pLon = Number(lon);
  const pLat = Number(lat);

  const t = Math.max(0, Math.min(Number(timeMs), SCORER_MAX_TIME_MS));

  const dKm = haversineDistanceKm(cLat, cLon, pLat, pLon);
  // createRoundScorer() returnerar en funktion (distanceKm, timeMs) => score
  const score = scorer(dKm, t);
  return { lon: pLon, lat: pLat, timeMs: t, distanceKm: dKm, score };
}

// ✅ Centraliserad "end round" så vi inte kan råka skicka round_result flera gånger
function endRoundOnce(match, round) {
  if (!match || match.finished) return false;
  if (!round || round.ended || round._resultEmitted) return false;

  round.ended = true;
  round._resultEmitted = true;

  clearTimeout(match.roundTimeout);
  match.roundTimeout = null;

  return true;
}

function emitRoundResultAndIntermission(match, round) {
  if (!match || match.finished) return;
  if (!round) return;

  // Om vi redan är i intermission för denna runda: gör inget (skydd mot dubbel-emits)
  if (match.awaitingReady) return;

  // Om någon råkar kalla hit utan endRoundOnce: gör det här också (failsafe)
  if (!round._resultEmitted) {
    round.ended = true;
    round._resultEmitted = true;
    clearTimeout(match.roundTimeout);
    match.roundTimeout = null;
  }

  const room = getRoomName(match.id);

  match.awaitingReady = true;
  match.ready.clear();

  const results = {};
  for (const p of match.players) {
    const click = round.clicks[p];
    results[p] = click
      ? { ...click }
      : {
          lon: null,
          lat: null,
          timeMs: PENALTY_TIME_MS,
          distanceKm: SCORER_MAX_DISTANCE_KM,
          score: match.scorer(SCORER_MAX_DISTANCE_KM, PENALTY_TIME_MS),
        };
  }

  io.to(room).emit("round_result", { results });

  match.readyPromptTimeout = setTimeout(() => {
    io.to(room).emit("ready_prompt", { roundIndex: match.currentRound });
  }, 2000);

  match.readyTimeout = setTimeout(() => {
    startNextRoundCountdown(match);
  }, 4_000);
}

function startNextRoundCountdown(match) {
  if (!match || match.finished) return;

  // ✅ Skydd: om countdown redan är igång, starta inte en till (detta var källan till >10 rundor)
  if (match._countdownRunning) return;
  match._countdownRunning = true;

  clearTimeout(match.readyPromptTimeout);
  clearTimeout(match.readyTimeout);

  const room = getRoomName(match.id);
  match.awaitingReady = false;
  match.ready.clear();

  const seconds = 5;
  io.to(room).emit("next_round_countdown", { seconds });

  clearTimeout(match.countdownTimeout);
  match.countdownTimeout = setTimeout(() => {
    match._countdownRunning = false;

    match.currentRound += 1;

    // ✅ Failsafe: om vi av någon anledning går över totalRounds, avsluta matchen direkt
    if (match.currentRound >= match.totalRounds) {
      finishMatch(match).catch(() => {});
      return;
    }

    // ✅ Viktigt för flow:
    // Mellan rundor ska vi INTE återinföra "start-ready"-gaten.
    clearTimeout(match.startReadyPromptTimeout);
    clearTimeout(match.startReadyTimeout);
    match.startReadyPromptTimeout = null;
    match.startReadyTimeout = null;
    match.awaitingStartReady = false;
    match.startReady.clear();

    startRound(match);
  }, seconds * 1000);
}

// =====================
// Cities: capitals markering + pools
// =====================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadCapitalsJson() {
  const p = path.join(__dirname, "capitals.json");
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Kunde inte läsa capitals.json:", e?.message || e);
    return [];
  }
}

function applyCapitalsToCities(cityList) {
  const caps = loadCapitalsJson();
  const capSet = new Set(
    (Array.isArray(caps) ? caps : [])
      .map(
        (c) =>
          `${String(c?.name || "").trim().toLowerCase()}|${String(c?.countryCode || "")
            .trim()
            .toUpperCase()}`
      )
      .filter((x) => x.split("|")[0] && x.split("|")[1])
  );

  for (const c of cityList) {
    const key = `${String(c?.name || "").trim().toLowerCase()}|${String(c?.countryCode || "")
      .trim()
      .toUpperCase()}`;
    c.isCapital = capSet.has(key);
  }
}

applyCapitalsToCities(cities);

// =====================
// City pools per difficulty
// =====================
// ✅ FIX: population kan vara strängar med mellanslag/komma/punkt (ex "25 000 000").
// Detta gjorde att safePop() tidigare gav NaN -> 0 och då blev easy/medium identiska.
function safePop(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  // "25 000 000" / "1,234,567" / "1.234.567" / "9 700 000" -> "25000000"
  const s = String(v).trim().replace(/[^\d-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const cityPools = {
  easy: [],
  medium: [],
  hard: cities,
};

function rebuildCityPools() {
  const easy = cities.filter((c) => !!c?.isCapital || safePop(c?.population) >= EASY_POP_MIN);

  const mediumSet = new Set(easy);
  for (const c of cities) {
    if (safePop(c?.population) >= MEDIUM_POP_MIN) mediumSet.add(c);
  }

  cityPools.easy = easy;
  cityPools.medium = Array.from(mediumSet);
  cityPools.hard = cities;

  console.log(
    `[cities] pools: easy=${cityPools.easy.length}, medium=${cityPools.medium.length}, hard=${cityPools.hard.length}`
  );
}

rebuildCityPools();

function startRound(match) {
  if (!match || match.finished) return;

  // ✅ Failsafe: om någon försöker starta runda utanför 0..totalRounds-1
  if (match.currentRound >= match.totalRounds) {
    finishMatch(match).catch(() => {});
    return;
  }

  const room = getRoomName(match.id);

  // Rensa ev. kvarvarande round-timeout (skydd mot dubbla rundstarter)
  clearTimeout(match.roundTimeout);
  match.roundTimeout = null;

  const d = normalizeDifficulty(match.difficulty);
  const poolList = cityPools[d] && cityPools[d].length ? cityPools[d] : cities;

  // ✅ Välj en stad med giltiga koordinater (skydd mot "buggade städer")
  let city = null;
  for (let i = 0; i < 50; i++) {
    const candidate = poolList[Math.floor(Math.random() * poolList.length)];
    const lat = Number(candidate?.lat);
    const lon = Number(candidate?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      city = candidate;
      break;
    }
  }
  if (!city) city = poolList[Math.floor(Math.random() * poolList.length)];

  const round = {
    city,
    clicks: {},
    startedAt: nowMs(),
    ended: false,
    _resultEmitted: false,
  };

  match.rounds[match.currentRound] = round;

  io.to(room).emit("round_start", {
    roundIndex: match.currentRound,
    cityName: city.name,
    cityMeta: {
      name: city.name,
      countryCode: city.countryCode || null,
      population: city.population || null,
      isCapital: !!city.isCapital,
      // Behövs av klienten för target-marker (visas ändå inte förrän efter round_result i UI)
      lat: Number.isFinite(Number(city.lat)) ? Number(city.lat) : null,
      lon: Number.isFinite(Number(city.lon)) ? Number(city.lon) : null,
      continent: city.continent || null,
    },
  });

  match.roundTimeout = setTimeout(() => {
    if (!match || match.finished) return;

    const r = match.rounds[match.currentRound];
    if (!r) return;

    // Om vi redan avslutat (t.ex. båda klickade) så gör inget.
    if (r.ended || r._resultEmitted) return;

    // Time-out: fyll straffklick för de som inte klickat
    for (const p of match.players) {
      if (!r.clicks[p]) {
        r.clicks[p] = calculateClick(city, city.lon, city.lat, PENALTY_TIME_MS, match.scorer);
      }
    }

    if (endRoundOnce(match, r)) {
      emitRoundResultAndIntermission(match, r);
    }
  }, ROUND_TIMEOUT_MS);
}

// =====================
// Badges + progression (finish overlay)
// =====================
async function awardBadgesAndLevelAfterMatchTx(dbClient, match, winner, totalScores) {
  // Badge/progression ska INTE triggas i öva/solo
  if (!match || match.isPractice || match.isSolo) return {};

  const [pA, pB] = match.players || [];
  const realPlayers = [pA, pB].filter((u) => u && u !== BOT_NAME);
  if (!realPlayers.length) return {};

  const catalog = await getBadgesCatalogWithCriteria(dbClient);
  const byCode = mapBadgesByCode(catalog);

  // Kolumn-kompat (level/badges_count kan saknas i vissa DB-varianter)
  const hasLevel = await hasColumn(dbClient, "users", "level");
  const hasBadgesCount = await hasColumn(dbClient, "users", "badges_count");
  const hasWinStreak = await hasColumn(dbClient, "users", "win_streak");

  const hasEasyWins = await hasColumn(dbClient, "users", "easy_wins");
  const hasMediumWins = await hasColumn(dbClient, "users", "medium_wins");
  const hasHardWins = await hasColumn(dbClient, "users", "hard_wins");

  const hasPlayedChallengesTotal = await hasColumn(dbClient, "users", "played_challenges_total");
  const hasWinsChallengesTotal = await hasColumn(dbClient, "users", "wins_challenges_total");
  const hasStartedMatchesViaQueue = await hasColumn(dbClient, "users", "started_matches_via_queue");

  const selectCols = ["username", "played", "wins", "losses"];
  if (hasLevel) selectCols.push("level");
  if (hasBadgesCount) selectCols.push("badges_count");
  if (hasWinStreak) selectCols.push("win_streak");
  if (hasEasyWins) selectCols.push("easy_wins");
  if (hasMediumWins) selectCols.push("medium_wins");
  if (hasHardWins) selectCols.push("hard_wins");
  if (hasPlayedChallengesTotal) selectCols.push("played_challenges_total");
  if (hasWinsChallengesTotal) selectCols.push("wins_challenges_total");
  if (hasStartedMatchesViaQueue) selectCols.push("started_matches_via_queue");

  const { rows: users } = await dbClient.query(
    `select ${selectCols.join(", ")} from users where username = any($1::text[]) for update`,
    [realPlayers]
  );
  const userByName = new Map(users.map((u) => [u.username, u]));

  // Hämta redan earned badge_codes för spelarna (snabbt filter innan insert)
  const { rows: earnedRows } = await dbClient.query(
    `select username, badge_code
     from public.user_badges
     where username = any($1::text[])`,
    [realPlayers]
  );
  const earnedByUser = new Map(); // username -> Set(code)
  for (const r of earnedRows) {
    if (!earnedByUser.has(r.username)) earnedByUser.set(r.username, new Set());
    if (r.badge_code) earnedByUser.get(r.username).add(r.badge_code);
  }

  const buildRoundsFor = (username) => {
    const arr = [];
    for (const r of match.rounds || []) {
      if (!r) continue;
      const click = r?.clicks?.[username] || null;
      const city = r?.city || null;

      arr.push({
        distanceKm: Number.isFinite(click?.distanceKm) ? click.distanceKm : null,
        timeMs: Number.isFinite(click?.timeMs) ? click.timeMs : null,
        score: Number.isFinite(click?.score) ? click.score : null,
        cityMeta: {
          name: city?.name ?? null,
          countryCode: city?.countryCode ?? null,
          population: city?.population ?? null,
          isCapital: !!city?.isCapital,
        },
      });
    }
    return arr;
  };

  const hasTimeoutRoundFor = (username) => {
    // "timeout" i din design = straffrunda (20s) pga ingen click.
    // Vi kan inte alltid skilja “klickade på exakt 20s” från “timeout”,
    // men här markerar vi timeout när en runda saknar click-data eller har null lon/lat.
    for (const r of match.rounds || []) {
      if (!r) continue;
      const c = r?.clicks?.[username];
      if (!c) return true;
      if (c.lon == null || c.lat == null) return true;
      // Fallback: om tiden är max och distansen är max (dvs default-penalty)
      if (Number.isFinite(c.timeMs) && Number.isFinite(c.distanceKm)) {
        if (c.timeMs >= PENALTY_TIME_MS && c.distanceKm >= SCORER_MAX_DISTANCE_KM - 1) return true;
      }
    }
    return false;
  };

  const progressionDelta = {}; // { [username]: { oldLevel, newLevel, oldBadgesCount, newBadgesCount, newBadges:[...] } }

  for (const username of realPlayers) {
    const user = userByName.get(username) || {
      username,
      played: 0,
      wins: 0,
      losses: 0,
      badges_count: 0,
      level: 0,
      win_streak: 0,
      easy_wins: 0,
      medium_wins: 0,
      hard_wins: 0,
    };

    const isWinner = !!winner && username === winner;
    const opponentName = username === pA ? pB : pA;

    const myTotal = Number(totalScores?.[username] ?? 0);
    const oppTotal = Number(totalScores?.[opponentName] ?? 0);

    const myRounds = buildRoundsFor(username);
    const oppRounds = opponentName && opponentName !== BOT_NAME ? buildRoundsFor(opponentName) : [];

    const earnedSet = earnedByUser.get(username) || new Set();
    const oldBadgesCount = hasBadgesCount ? Number(user.badges_count ?? 0) : earnedSet.size;
    const oldLevel = hasLevel ? Number(user.level ?? 0) : oldBadgesCount;

    const oppEarnedSet = opponentName ? earnedByUser.get(opponentName) : null;
    const oppBadgesCount =
      opponentName && opponentName !== BOT_NAME
        ? (hasBadgesCount ? Number((userByName.get(opponentName) || {}).badges_count ?? 0) : (oppEarnedSet?.size ?? 0))
        : 0;

    const eligibleCodes = evaluateEligibleBadgeCodes({
      catalog,
      userStats: {
        played: Number(user.played ?? 0),
        wins: Number(user.wins ?? 0),
        losses: Number(user.losses ?? 0),
        winStreak: hasWinStreak ? Number(user.win_streak ?? 0) : null,
        winsByDifficulty: {
          easy: hasEasyWins ? Number(user.easy_wins ?? 0) : null,
          medium: hasMediumWins ? Number(user.medium_wins ?? 0) : null,
          hard: hasHardWins ? Number(user.hard_wins ?? 0) : null,
        },        playedChallengesTotal: hasPlayedChallengesTotal ? Number(user.played_challenges_total ?? 0) : null,
        winsChallengesTotal: hasWinsChallengesTotal ? Number(user.wins_challenges_total ?? 0) : null,
        startedMatchesViaQueue: hasStartedMatchesViaQueue ? Number(user.started_matches_via_queue ?? 0) : null,
      },
      isWinner,
      match: {
        difficulty: match.difficulty ?? DEFAULT_DIFFICULTY,
        isSolo: !!match.isSolo,
        isPractice: !!match.isPractice,
        hasTimeoutRound: hasTimeoutRoundFor(username),
        rounds: myRounds,
      },
      opponent: {
        badgesCount: oppBadgesCount,
        totalScore: oppTotal,
        rounds: oppRounds,
      },
      totalScores,
      winner,
      username,
    });

    const missingCodes = (eligibleCodes || []).filter((code) => code && !earnedSet.has(code));
    let newlyInsertedCodes = [];

    if (missingCodes.length) {
      const meta = {
        source: "match_finished",
        matchId: match.id,
        winner: isWinner,
        difficulty: match.difficulty ?? DEFAULT_DIFFICULTY,
      };

      const { rows: ins } = await dbClient.query(
        `insert into public.user_badges (username, badge_code, earned_at, match_id, meta)
         select $1, x, now(), $2, $3::jsonb
         from unnest($4::text[]) as x
         on conflict (username, badge_code) do nothing
         returning badge_code`,
        [username, match.id, JSON.stringify(meta), missingCodes]
      );

      newlyInsertedCodes = ins.map((r) => r.badge_code).filter(Boolean);

      // uppdatera local earnedSet så counts/logik blir konsekvent
      for (const c of newlyInsertedCodes) earnedSet.add(c);
      earnedByUser.set(username, earnedSet);
    }

    // badges_count / level sync (om kolumner finns)
    let newBadgesCount = oldBadgesCount;
    if (newlyInsertedCodes.length) {
      // snabb variant: old + delta
      newBadgesCount = oldBadgesCount + newlyInsertedCodes.length;
    } else {
      newBadgesCount = oldBadgesCount;
    }

    // Om badges_count-kolumnen finns, ta hellre “sanning” från DB-count (tål parallella insertions bättre)
    if (hasBadgesCount) {
      const { rows: cntRows } = await dbClient.query(
        `select count(*)::int as c from public.user_badges where username = $1`,
        [username]
      );
      newBadgesCount = cntRows[0]?.c ?? newBadgesCount;
    }

    const matchesLevel = Math.floor(Number(user.played ?? 0) / 20);
    const newLevel = matchesLevel + newBadgesCount;

    if (hasBadgesCount || hasLevel) {
      const sets = [];
      const params = [username];
      let i = 2;

      if (hasBadgesCount) {
        sets.push(`badges_count = $${i++}`);
        params.push(newBadgesCount);
      }
      if (hasLevel) {
        sets.push(`level = $${i++}`);
        params.push(newLevel);
      }

      if (sets.length) {
        await dbClient.query(`update users set ${sets.join(", ")} where username = $1`, params);
      }
    }

    const newBadges = newlyInsertedCodes
      .map((code) => byCode.get(code))
      .filter(Boolean)
      .map((b) => ({
        code: b.code,
        name: b.name,
        description: b.description,
        emoji: b.emoji,
        groupKey: b.groupKey,
        groupName: b.groupName,
        sortInGroup: b.sortInGroup,
        iconUrl: b.iconUrl,
      }));

    progressionDelta[username] = {
      username,
      oldLevel,
      newLevel,
      oldBadgesCount,
      newBadgesCount,
      newBadges,
    };
  }

  return progressionDelta;
}

function computeTotalsFromRounds(match) {
  const [pA, pB] = match.players;
  const total = { [pA]: 0, [pB]: 0 };

  for (const r of match.rounds) {
    if (!r) continue;
    total[pA] += r.clicks?.[pA]?.score ?? 0;
    total[pB] += r.clicks?.[pB]?.score ?? 0;
  }

  return total;
}

async function updatePersonalRecordsTx(dbClient, match, total, winner, opts = {}) {
  const [pA, pB] = match.players;
  const realPlayers = [pA, pB].filter((u) => u !== BOT_NAME);

  if (match.isPractice) return;
  if (!realPlayers.length) return;

  const isWalkover = !!opts.walkover;
  if (isWalkover) return;

  const hasBestMatchScore = await hasColumn(dbClient, "users", "best_match_score");
  const hasBestWinMargin = await hasColumn(dbClient, "users", "best_win_margin");
  if (!hasBestMatchScore && !hasBestWinMargin) return;

  if (hasBestMatchScore) {
    for (const u of realPlayers) {
      const s = Number(total?.[u]);
      if (!Number.isFinite(s)) continue;
      await dbClient.query(
        `update users
         set best_match_score =
           case
             when best_match_score is null then $2
             when $2 < best_match_score then $2
             else best_match_score
           end
         where username = $1`,
        [u, Math.round(s)]
      );
    }
  }

  const bothReal = pA !== BOT_NAME && pB !== BOT_NAME;
  if (hasBestWinMargin && bothReal && winner) {
    const loser = winner === pA ? pB : pA;
    const wScore = Number(total?.[winner]);
    const lScore = Number(total?.[loser]);
    if (Number.isFinite(wScore) && Number.isFinite(lScore) && lScore > wScore) {
      const margin = Math.round(lScore - wScore);
      await dbClient.query(
        `update users
         set best_win_margin = greatest(coalesce(best_win_margin, 0), $2)
         where username = $1`,
        [winner, margin]
      );
    }
  }
}

async function finishMatch(match, opts = {}) {
  if (!match || match.finished) return;

  match.finished = true;
  match.finishedAt = nowMs();
  match.finishReason = opts.reason ?? "normal";

  clearAllMatchTimers(match);
  clearActiveMatchForPlayers(match);

  for (const p of match.players) {
    if (p && p !== BOT_NAME) clearDisconnectGrace(p);
  }

  const [pA, pB] = match.players;

  let total = opts.totalOverride ?? computeTotalsFromRounds(match);

  let winner = null;
  if (opts.winnerOverride) {
    winner = opts.winnerOverride;
  } else if (!match.isPractice) {
    if (total[pA] < total[pB]) winner = pA;
    else if (total[pB] < total[pA]) winner = pB;
  }

  const realPlayers = [pA, pB].filter((u) => u !== BOT_NAME);

  let progressionDelta = {};

  if (!match.isPractice && realPlayers.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("begin");

      const bothReal = pA !== BOT_NAME && pB !== BOT_NAME;
      const dc = diffCols(match.difficulty);

      const isWalkover = !!opts.walkover;
      const walkoverLoser = opts.walkoverLoser ?? null;
      const walkoverWinner = opts.walkoverWinner ?? null;

      if (isWalkover && bothReal && walkoverLoser && walkoverWinner) {
        const { rows: rowsA } = await client.query(
          `select username, played, total_score, avg_score
           from users where username = $1 for update`,
          [walkoverWinner]
        );

        const w = rowsA[0];

        let winnerMatchScore = 0;
        if (w && Number(w.played) > 0) {
          const ts = Number(w.total_score ?? 0);
          const pl = Number(w.played ?? 0);
          winnerMatchScore = pl > 0 ? Math.round(ts / pl) : 0;
        }

        const loserMatchScore = WALKOVER_LOSER_SCORE;

        total = {
          [walkoverWinner]: winnerMatchScore,
          [walkoverLoser]: loserMatchScore,
        };
        winner = walkoverWinner;

        await client.query(
          `update users
           set played = played + 1,
               total_score = total_score + $2,
               ${dc.played} = ${dc.played} + 1,
               ${dc.totalScore} = ${dc.totalScore} + $2
           where username = $1`,
          [walkoverWinner, winnerMatchScore]
        );
        await client.query(
          `update users
           set played = played + 1,
               total_score = total_score + $2,
               ${dc.played} = ${dc.played} + 1,
               ${dc.totalScore} = ${dc.totalScore} + $2
           where username = $1`,
          [walkoverLoser, loserMatchScore]
        );

        await client.query(`update users set wins = wins + 1, ${dc.wins} = ${dc.wins} + 1 where username=$1`, [
          walkoverWinner,
        ]);
        await client.query(`update users set losses = losses + 1, ${dc.losses} = ${dc.losses} + 1 where username=$1`, [
          walkoverLoser,
        ]);

        const hasWinStreak = await hasColumn(client, "users", "win_streak");
        if (hasWinStreak) {
          await client.query(`update users set win_streak = coalesce(win_streak,0) + 1 where username=$1`, [
            walkoverWinner,
          ]);
          await client.query(`update users set win_streak = 0 where username=$1`, [walkoverLoser]);
        }

        await client.query(
          `update users
           set avg_score = case when played > 0 then total_score / played else 0 end
           where username = any($1::text[])`,
          [[walkoverWinner, walkoverLoser]]
        );

        await client.query(
          `update users
           set pct = case
             when (wins + losses) > 0 then round(100.0 * wins / (wins + losses), 1)
             else null
           end
           where username = any($1::text[])`,
          [[walkoverWinner, walkoverLoser]]
        );

        progressionDelta = {};
      } else {
        for (const u of realPlayers) {
          await client.query(
            `update users
             set played = played + 1,
                 total_score = total_score + $2,
                 ${dc.played} = ${dc.played} + 1,
                 ${dc.totalScore} = ${dc.totalScore} + $2
             where username = $1`,
            [u, total[u] ?? 0]
          );
        }

        // --- Challenge/Queue counters (optional columns)
        const hasPlayedChallenges = await hasColumn(client, "users", "played_challenges_total");
        const hasWinsChallenges = await hasColumn(client, "users", "wins_challenges_total");
        const hasStartedViaQueue = await hasColumn(client, "users", "started_matches_via_queue");

        if (!match.isSolo && !match.isPractice) {
          if (match.source === "challenge" && hasPlayedChallenges) {
            await client.query(
              `update users
               set played_challenges_total = coalesce(played_challenges_total,0) + 1
               where username = any($1::text[])`,
              [realPlayers]
            );
          }

          if (match.source === "queue" && hasStartedViaQueue) {
            await client.query(
              `update users
               set started_matches_via_queue = coalesce(started_matches_via_queue,0) + 1
               where username = any($1::text[])`,
              [realPlayers]
            );
          }

          if (match.source === "challenge" && winner && bothReal && hasWinsChallenges) {
            await client.query(
              `update users
               set wins_challenges_total = coalesce(wins_challenges_total,0) + 1
               where username = $1`,
              [winner]
            );
          }
        }


        if (winner && bothReal) {
          const loser = winner === pA ? pB : pA;

          await client.query(`update users set wins = wins + 1, ${dc.wins} = ${dc.wins} + 1 where username=$1`, [
            winner,
          ]);
          await client.query(`update users set losses = losses + 1, ${dc.losses} = ${dc.losses} + 1 where username=$1`, [
            loser,
          ]);

          const hasWinStreak = await hasColumn(client, "users", "win_streak");
          if (hasWinStreak) {
            await client.query(`update users set win_streak = coalesce(win_streak,0) + 1 where username=$1`, [winner]);
            await client.query(`update users set win_streak = 0 where username=$1`, [loser]);
          }
        }

        await client.query(
          `update users
           set avg_score = case when played > 0 then total_score / played else 0 end
           where username = any($1::text[])`,
          [realPlayers]
        );

        await client.query(
          `update users
           set pct = case
             when (wins + losses) > 0 then round(100.0 * wins / (wins + losses), 1)
             else null
           end
           where username = any($1::text[])`,
          [realPlayers]
        );

        await updatePersonalRecordsTx(client, match, total, winner, { walkover: false });
        progressionDelta = await awardBadgesAndLevelAfterMatchTx(client, match, winner, total);
      }

      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      console.error("finishMatch tx error", e);
    } finally {
      client.release();
    }
  }

  io.to(getRoomName(match.id)).emit("match_finished", {
    totalScores: total,
    winner,
    progressionDelta,
    finishReason: match.finishReason,
  });
}

async function finishMatchAsWalkover(match, winner, loser, reason) {
  if (!match || match.finished) return;
  await finishMatch(match, {
    walkover: true,
    walkoverWinner: winner,
    walkoverLoser: loser,
    winnerOverride: winner,
    reason,
  });
}

// =====================
// Challenge helpers + difficulty
// =====================
function makeChallengeKey(from, to) {
  return `${from}->${to}`;
}

function clearChallengeById(challengeId) {
  const entry = pendingChallengesById.get(challengeId);
  if (!entry) return;
  pendingChallengesById.delete(challengeId);
  pendingChallengeByPair.delete(makeChallengeKey(entry.from, entry.to));
}

function createPendingChallenge(from, to, difficulty) {
  const pairKey = makeChallengeKey(from, to);
  const oldId = pendingChallengeByPair.get(pairKey);
  if (oldId) clearChallengeById(oldId);

  const id = crypto.randomBytes(8).toString("hex");
  const entry = {
    id,
    from,
    to,
    difficulty: normalizeDifficulty(difficulty),
    expiresAt: nowMs() + CHALLENGE_TTL_MS,
  };
  pendingChallengesById.set(id, entry);
  pendingChallengeByPair.set(pairKey, id);
  return entry;
}

function getValidChallengeById(challengeId) {
  const entry = pendingChallengesById.get(challengeId);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs()) {
    clearChallengeById(challengeId);
    return null;
  }
  return entry;
}

function getValidChallengeByPair(from, to) {
  const id = pendingChallengeByPair.get(makeChallengeKey(from, to));
  if (!id) return null;
  return getValidChallengeById(id);
}

// =====================
// Sweep
// =====================
setInterval(() => {
  const now = nowMs();

  for (const [id, entry] of pendingChallengesById.entries()) {
    if (!entry || entry.expiresAt <= now) clearChallengeById(id);
  }

  for (const [id, match] of matches.entries()) {
    if (!match) {
      matches.delete(id);
      continue;
    }

    const age = now - (match.createdAt ?? now);
    const finishedAge = match.finished ? now - (match.finishedAt ?? now) : 0;

    const shouldDelete = (match.finished && finishedAge > MATCH_FINISHED_TTL_MS) || age > MATCH_MAX_AGE_MS;

    if (shouldDelete) {
      clearAllMatchTimers(match);
      matches.delete(id);
    }
  }
}, MATCH_SWEEP_INTERVAL_MS).unref?.();

// =====================
// Socket handlers
// =====================
io.on("connection", (socket) => {
  let currentUser = null;

  socket.on("auth", async (sessionId) => {
    try {
      const username = await getUsernameFromSession(sessionId);
      if (!username) {
        socket.emit("auth_error", "Ogiltig session, logga in igen.");
        return;
      }

      const oldSocketId = socketsByUser.get(username);
      if (oldSocketId && oldSocketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          oldSocket.emit("forced_logout", "Du blev utloggad eftersom du loggade in i en annan flik.");
          oldSocket.disconnect(true);
        }
      }

      currentUser = username;
      socketsByUser.set(username, socket.id);

      clearDisconnectGrace(username);

      lobby.onlineUsers.add(username);
      broadcastLobby();

      // ✅ Skicka queue_state direkt (så Lobby alltid vet status efter refresh)
      let queuedDifficulty = null;
      for (const d of DIFFICULTIES) {
        if (lobby.queues[d].has(username)) {
          queuedDifficulty = d;
          break;
        }
      }
      socket.emit("queue_state", {
        queued: !!queuedDifficulty,
        difficulty: queuedDifficulty,
      });
    } catch (e) {
      console.error(e);
      socket.emit("auth_error", "Serverfel vid auth.");
    }
  });

  socket.on("start_random_match", (payload) => {
    if (!currentUser) return;

    const difficulty =
      payload && typeof payload === "object" ? normalizeDifficulty(payload.difficulty) : DEFAULT_DIFFICULTY;

    if (isUserInActiveMatch(currentUser)) {
      socket.emit("match_error", "Du är redan i en match.");
      return;
    }

    removeUserFromAllQueues(currentUser);
    lobby.queues[difficulty].add(currentUser);

    socket.emit("queue_state", { queued: true, difficulty });
    broadcastLobby();
    tryMatchQueue(difficulty);
  });

  socket.on("set_queue", (payload) => {
    if (!currentUser) return;

    const queued = !!payload?.queued;
    const difficulty = normalizeDifficulty(payload?.difficulty);

    if (isUserInActiveMatch(currentUser)) {
      socket.emit("match_error", "Du är redan i en match.");
      return;
    }

    if (!queued) {
      removeUserFromAllQueues(currentUser);
      socket.emit("queue_state", { queued: false, difficulty: null });
      broadcastLobby();
      return;
    }

    removeUserFromAllQueues(currentUser);
    lobby.queues[difficulty].add(currentUser);

    socket.emit("queue_state", { queued: true, difficulty });
    broadcastLobby();
    tryMatchQueue(difficulty);
  });

  socket.on("leave_queue", () => {
    if (!currentUser) return;
    removeUserFromAllQueues(currentUser);
    socket.emit("queue_state", { queued: false, difficulty: null });
    broadcastLobby();
  });

  // ✅ Uppdaterad: tar payload { difficulty }
  socket.on("start_solo_match", (payload) => {
    if (!currentUser) return;

    if (isUserInActiveMatch(currentUser)) {
      socket.emit("match_error", "Du är redan i en match.");
      return;
    }

    const difficulty =
      payload && typeof payload === "object" ? normalizeDifficulty(payload.difficulty) : normalizeDifficulty("hard");

    removeUserFromAllQueues(currentUser);
    broadcastLobby();

    const match = createMatch(currentUser, BOT_NAME, {
      isSolo: true,
      isPractice: true,
      difficulty,
      source: "solo",
    });
    startSoloMatch(match, socket);
  });

  socket.on("challenge_player", (payload) => {
    if (!currentUser) return;

    if (isUserInActiveMatch(currentUser)) {
      socket.emit("challenge_error", "Du är redan i en match.");
      return;
    }

    const target =
      typeof payload === "string" ? String(payload || "").trim() : String(payload?.targetUsername || "").trim();
    const difficulty =
      typeof payload === "object" && payload ? normalizeDifficulty(payload.difficulty) : DEFAULT_DIFFICULTY;

    if (!target) return;
    if (target === currentUser) {
      socket.emit("challenge_error", "Du kan inte utmana dig själv 😅");
      return;
    }

    if (isUserInActiveMatch(target)) {
      socket.emit("challenge_error", "Spelaren är upptagen i en match");
      return;
    }

    const targetSocketId = socketsByUser.get(target);
    if (!targetSocketId) {
      socket.emit("challenge_error", "Spelaren är inte online");
      return;
    }

    removeUserFromAllQueues(currentUser);
    broadcastLobby();

    const entry = createPendingChallenge(currentUser, target, difficulty);

    io.to(targetSocketId).emit("challenge_received", {
      from: currentUser,
      difficulty: entry.difficulty,
      challengeId: entry.id,
    });

    socket.emit("challenge_sent", { to: target, difficulty: entry.difficulty, challengeId: entry.id });
  });

  socket.on("decline_challenge", (payload) => {
    if (!currentUser) return;

    const challengeId = payload && typeof payload === "object" ? String(payload.challengeId || "").trim() : "";
    const fromFallback =
      typeof payload === "string" ? String(payload || "").trim() : String(payload?.fromUsername || "").trim();

    let entry = null;
    if (challengeId) entry = getValidChallengeById(challengeId);
    else if (fromFallback) entry = getValidChallengeByPair(fromFallback, currentUser);

    if (!entry) return;
    if (entry.to !== currentUser) return;

    const fromSocketId = socketsByUser.get(entry.from);
    clearChallengeById(entry.id);

    if (fromSocketId) {
      io.to(fromSocketId).emit("challenge_declined", {
        to: currentUser,
        challengeId: entry.id,
      });
    }
  });

  socket.on("accept_challenge", (payload) => {
    if (!currentUser) return;

    if (isUserInActiveMatch(currentUser)) {
      socket.emit("challenge_error", "Du är redan i en match.");
      return;
    }

    const challengeId = payload && typeof payload === "object" ? String(payload.challengeId || "").trim() : "";
    const fromFallback =
      typeof payload === "string" ? String(payload || "").trim() : String(payload?.fromUsername || "").trim();

    let entry = null;

    if (challengeId) {
      entry = getValidChallengeById(challengeId);
    } else if (fromFallback) {
      entry = getValidChallengeByPair(fromFallback, currentUser);
    }

    if (!entry) {
      socket.emit("challenge_error", "Utmaningen är ogiltig eller har gått ut.");
      return;
    }

    const from = entry.from;
    const difficulty = entry.difficulty;

    if (entry.to !== currentUser) {
      socket.emit("challenge_error", "Utmaningen är inte riktad till dig.");
      return;
    }

    const fromSocketId = socketsByUser.get(from);
    if (!fromSocketId) {
      socket.emit("challenge_error", "Utmanaren är inte längre online");
      clearChallengeById(entry.id);
      return;
    }

    if (isUserInActiveMatch(from)) {
      socket.emit("challenge_error", "Utmanaren är upptagen i en match");
      clearChallengeById(entry.id);
      return;
    }

    clearChallengeById(entry.id);
    removeUserFromAllQueues(currentUser);
    removeUserFromAllQueues(from);
    broadcastLobby();

    const match = createMatch(from, currentUser, { difficulty, source: "challenge" });
    startMatch(match);
  });

  socket.on("leave_match", async ({ matchId }) => {
    try {
      if (!currentUser) return;
      const match = matches.get(matchId);
      if (!match || match.finished) return;
      if (!match.players.includes(currentUser)) return;

      const [pA, pB] = match.players;
      if (pA === BOT_NAME || pB === BOT_NAME) {
        await finishMatch(match, { reason: "leave" });
        return;
      }

      const loser = currentUser;
      const winner = loser === pA ? pB : pA;

      await finishMatchAsWalkover(match, winner, loser, "leave");
    } catch (e) {
      console.error("leave_match error", e);
    }
  });

  socket.on("player_start_ready", ({ matchId }) => {
    const match = matches.get(matchId);
    if (!match || match.finished) return;
    if (!match.players.includes(currentUser)) return;
    if (!match.awaitingStartReady) return;

    match.startReady.add(currentUser);
    const [pA, pB] = match.players;
    const bothReady = match.startReady.has(pA) && match.startReady.has(pB);

    if (match.isSolo) {
      if (match.startReady.has(pA) || match.startReady.has(pB)) {
        clearStartReady(match);
        startRound(match);
      }
      return;
    }

    if (bothReady) {
      clearStartReady(match);
      startRound(match);
    }
  });

	 
socket.on("player_click", ({ matchId, lon, lat, timeMs }) => {
  const match = matches.get(matchId);
  if (!match || match.finished) return;
  if (!currentUser) return;
  if (!match.players.includes(currentUser)) return;
  if (match.awaitingStartReady) return;

  const pLon = Number(lon);
  const pLat = Number(lat);
  const pTime = Number(timeMs);

  // Tillåt strängar (från JSON) men kräver att de blir giltiga numbers
  if (!Number.isFinite(pLon) || !Number.isFinite(pLat) || !Number.isFinite(pTime)) return;

  const round = match.rounds[match.currentRound];
  if (!round || round.ended || round._resultEmitted) return;

  // Om vi redan är i intermission: ignorera (skydd mot sena klick som spökar)
  if (match.awaitingReady) return;

  // Spara spelarens click en gång
  if (!round.clicks[currentUser]) {
    round.clicks[currentUser] = calculateClick(round.city, pLon, pLat, pTime, match.scorer);
  }

  // ✅ ÖVA/SOLO mot bot: avsluta rundan direkt när spelaren klickar
  const hasBot = match.players.includes(BOT_NAME);
  if (hasBot) {
    if (!round.clicks[BOT_NAME]) {
      round.clicks[BOT_NAME] = calculateClick(
        round.city,
        round.city.lon,
        round.city.lat,
        PENALTY_TIME_MS,
        match.scorer
      );
    }

    if (endRoundOnce(match, round)) {
      emitRoundResultAndIntermission(match, round);
    }
    return;
  }

  // ✅ Vanlig 1v1: vänta tills båda klickat — och först DÅ skickar vi round_result
  const [pA, pB] = match.players;
  if (round.clicks[pA] && round.clicks[pB]) {
    if (endRoundOnce(match, round)) {
      emitRoundResultAndIntermission(match, round);
    }
  }
});

  socket.on("player_ready", ({ matchId, roundIndex }) => {
    const match = matches.get(matchId);
    if (!match || match.finished) return;
    if (!match.players.includes(currentUser)) return;
    if (!match.awaitingReady) return;
    if (roundIndex !== match.currentRound) return;

    match.ready.add(currentUser);
    const [pA, pB] = match.players;
    const bothReady = match.ready.has(pA) && match.ready.has(pB);
    if (bothReady) startNextRoundCountdown(match);
  });

  socket.on("disconnect", () => {
    if (!currentUser) return;

    lobby.onlineUsers.delete(currentUser);
    removeUserFromAllQueues(currentUser);

    const mapped = socketsByUser.get(currentUser);
    if (mapped === socket.id) socketsByUser.delete(currentUser);

    broadcastLobby();

    const matchId = activeMatchByUser.get(currentUser);
    if (!matchId) return;

    const match = matches.get(matchId);
    if (!match || match.finished) return;

    const [pA, pB] = match.players;
    if (pA === BOT_NAME || pB === BOT_NAME) return;

    if (disconnectGrace.has(currentUser)) return;

    const t = setTimeout(async () => {
      try {
        if (socketsByUser.has(currentUser) && lobby.onlineUsers.has(currentUser)) {
          clearDisconnectGrace(currentUser);
          return;
        }

        const m = matches.get(matchId);
        if (!m || m.finished) {
          clearDisconnectGrace(currentUser);
          return;
        }

        const loser = currentUser;
        const winner = loser === pA ? pB : pA;

        await finishMatchAsWalkover(m, winner, loser, "disconnect");
      } catch (e) {
        console.error("disconnect grace walkover error", e);
      } finally {
        clearDisconnectGrace(currentUser);
      }
    }, DISCONNECT_GRACE_MS);

    disconnectGrace.set(currentUser, t);
  });
});

// =====================
// Starta servern
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server lyssnar på port", PORT));
