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
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 10000,
  pingTimeout: 20000,
});

app.use(cors());
app.use(express.json());

// =====================
// Health / warmup endpoint
// =====================
// Used by the client (and optional external pingers) to wake the server quickly
// without doing any heavy DB work.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

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
const SCORER_MAX_DISTANCE_KM = 17_000;

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
// Guest / "Try" mode helpers
// =====================
// We allow a lightweight "guest" session to exist without a row in `users`.
// This is used for the Login-page "Prova" button (trial practice match).
// Guest usernames are never meant to store progression (XP/badges/ELO).
const GUEST_PREFIX = "__guest__";

function makeGuestUsername() {
  // Example: __guest__k5r7q9_7a3f
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(2).toString("hex");
  return `${GUEST_PREFIX}${ts}_${rnd}`;
}

function isGuestUsername(u) {
  return typeof u === "string" && u.startsWith(GUEST_PREFIX);
}

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
  const username = rows[0]?.username ?? null;

  // ✅ Uppdatera "senast sedd" för att cron-jobbet ska kunna plocka bort inaktiva sessions.
  if (username) {
    // best effort – ska inte blockera request om något strular
    pool.query("update sessions set last_seen = now() where id=$1", [sessionId]).catch(() => {});
  }

  return username;
}

async function deleteSession(sessionId) {
  await pool.query("delete from sessions where id=$1", [sessionId]);
}

function trackSessionSocket(sessionId, socketId) {
  sessionBySocket.set(socketId, sessionId);
  let set = socketsBySession.get(sessionId);
  if (!set) {
    set = new Set();
    socketsBySession.set(sessionId, set);
  }
  set.add(socketId);
}

function untrackSessionSocket(socketId) {
  const sessionId = sessionBySocket.get(socketId);
  sessionBySocket.delete(socketId);
  if (!sessionId) return;

  const set = socketsBySession.get(sessionId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    socketsBySession.delete(sessionId);
    // IMPORTANT: Don't delete the DB session on disconnect.
    // Refresh/reconnect and multi-tab would otherwise cause accidental logouts.
    // Session rows are cleaned up by expires_at in the periodic DB job above.
  }
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
// Leaderboard SCORE (anti-easy-farm)
// =====================
// SCORE är avsedd för topplistan (wide leaderboard) och är konstruerad för att:
// - belöna hög vinst% (PCT) och låg PPM (lägre = bättre)
// - ge Medel/Svår mycket större tyngd än Easy
// - men kräva ett rimligt antal matcher i Medel/Svår innan de dominerar (confidence)
// - ge fler matcher + högre level en bonus med avtagande effekt
//
// Designparametrar (tunna gärna):
const SCORE_PARAMS = Object.freeze({
  // Vinst-smoothing (Bayes/Laplace)
  winPriorStrength: 12, // lite stabilare PCT när N är litet
  winPriorP: 0.5,

  // PPM -> (0..1] (lägre PPM => högre score)
  // lite mjukare kurva än innan för att inte överdriva skillnader
  ppmCurveK: 1.35,
  ppmC: { easy: 650, medium: 1350, hard: 1750 },

  // Mix win vs ppm per diff (PCT + PPM är huvudsignal)
  // små skillnader mellan svårigheter, inte stora hopp
  lambda: { easy: 0.60, medium: 0.62, hard: 0.64 },

  // Svårighetsvikter (mycket mindre gap än 1/4/8)
  w: { easy: 1.0, medium: 1.8, hard: 2.4 },

  // Confidence per diff (kräver matcher, men inte lika hårt)
  confK: { easy: 12, medium: 10, hard: 9 },

  // Exposure: easy-only ska fortfarande inte maxa, men mildare straff
  exposureFloor: 0.85,

  // Match-trust (avtagande)
  matchK: 30,

  // Liten “vinster”-faktor (mest tie-breaker-ish)
  winsB: 0.07, // max ~ +7–10% beroende på clamp
  winsK: 40,   // ungefär där bonusen “mättar” tydligt

  // Output scaling
  scale: 10000,
});


function _toFiniteNum(v, fallback = null) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _expSafe(x) {
  // skydda mot NaN/Infinity
  if (!Number.isFinite(x)) return 0;
  // Math.exp(709) ~ 8e307 (nära max double)
  if (x > 700) return Number.POSITIVE_INFINITY;
  if (x < -700) return 0;
  return Math.exp(x);
}

function _ppmToScore(ppm, C, k) {
  const p = _toFiniteNum(ppm, 20000);
  const c = Math.max(1, _toFiniteNum(C, 1000));
  const kk = Math.max(0.1, _toFiniteNum(k, 1.5));
  // exp(-k * ln(1 + ppm/C)) == (1 + ppm/C)^(-k)
  return _expSafe(-kk * Math.log(1 + p / c));
}

function _winAdj(wins, played, a, p0) {
  const W = Math.max(0, _toFiniteNum(wins, 0));
  const N = Math.max(0, _toFiniteNum(played, 0));
  const aa = Math.max(0, _toFiniteNum(a, 10));
  const prior = Math.min(1, Math.max(0, _toFiniteNum(p0, 0.5)));
  if (N <= 0 && aa <= 0) return prior;
  return (W + aa * prior) / (N + aa);
}

function _confidence(played, k) {
  const N = Math.max(0, _toFiniteNum(played, 0));
  const kk = Math.max(1, _toFiniteNum(k, 10));
  return 1 - _expSafe(-N / kk);
}

function computeLeaderboardScore(row) {
  // Row comes from leaderboard_wide (snake-ish keys)
  const lvl = Math.max(0, _toFiniteNum(row?.lvl ?? row?.level, 0));

  // Läs svårighetsfält (defensivt)
  const e = {
    played: Math.max(0, _toFiniteNum(row?.e_sp, 0)),
    wins: Math.max(0, _toFiniteNum(row?.e_vm, 0)),
    ppm: _toFiniteNum(row?.e_ppm, null),
  };
  const m = {
    played: Math.max(0, _toFiniteNum(row?.m_sp, 0)),
    wins: Math.max(0, _toFiniteNum(row?.m_vm, 0)),
    ppm: _toFiniteNum(row?.m_ppm, null),
  };
  const h = {
    played: Math.max(0, _toFiniteNum(row?.s_sp, 0)),
    wins: Math.max(0, _toFiniteNum(row?.s_vm, 0)),
    ppm: _toFiniteNum(row?.s_ppm, null),
  };

  // Total played: ta t_sp om den finns, annars summera
  const tPlayed = _toFiniteNum(row?.t_sp, null);
  const Ntot = Math.max(0, tPlayed != null ? tPlayed : e.played + m.played + h.played);
  if (Ntot <= 0) return 0;

  const p = SCORE_PARAMS;

  // Fallbacks om du råkat ha en SCORE_PARAMS utan levelB/levelK (så du inte får runtime-crash)
  const levelB = _toFiniteNum(p?.levelB, 0.06);            // liten bonus per level, avtagande
  const levelK = Math.max(1, _toFiniteNum(p?.levelK, 25)); // ungefär där bonusen börjar mätta

  const per = [
    { key: "easy", ...e },
    { key: "medium", ...m },
    { key: "hard", ...h },
  ];

  // Per-difficulty performance S_d + confidence c_d
  for (const d of per) {
    const Pwin = _winAdj(d.wins, d.played, p.winPriorStrength, p.winPriorP);
    const Sppm = _ppmToScore(d.ppm, p.ppmC[d.key], p.ppmCurveK);
    const lam = _toFiniteNum(p.lambda[d.key], 0.6);

    d.S = Math.min(1, Math.max(0, lam * Pwin + (1 - lam) * Sppm));
    d.c = d.played > 0 ? _confidence(d.played, p.confK[d.key]) : 0;
    d.w = _toFiniteNum(p.w[d.key], 1);
  }

  // Weighted skill score with confidence gating
  let num = 0;
  let den = 0;

  // Exposure ska INTE bero på confidence (annars blir “straff” två gånger för få matcher).
  // Den ska bara spegla att man faktiskt exponerat sig för medium/hard överhuvudtaget.
  let exposureNum = 0;
  const exposureDen =
    _toFiniteNum(p?.w?.easy, 1) + _toFiniteNum(p?.w?.medium, 1) + _toFiniteNum(p?.w?.hard, 1);

  for (const d of per) {
    const wc = d.w * d.c;
    if (wc > 0) {
      num += wc * d.S;
      den += wc;
    }
    // Exposure: vikt * (har spelat något alls i svårigheten)
    if (d.played > 0) exposureNum += d.w;
  }

  const S_skill = den > 0 ? num / den : 0;

  // Difficulty exposure multiplier: easy-only can't reach full potential
  const E = exposureDen > 0 ? exposureNum / exposureDen : 0;
  const floor = _toFiniteNum(p.exposureFloor, 0.85);
  const Mdiff = floor + (1 - floor) * Math.min(1, Math.max(0, E));

  // Match factor (trust) – avtagande, men växer med antal matcher
  const matchK = Math.max(1, _toFiniteNum(p.matchK, 30));
  const FN = 1 - _expSafe(-Ntot / matchK);

  // Level factor (avtagande)
  const FL = 1 + levelB * Math.log(1 + lvl / levelK);

  const scale = Math.max(1, _toFiniteNum(p.scale, 10000));
  const raw = scale * S_skill * Mdiff * FN * FL;

  const out = Math.round(Math.max(0, raw));
  return Number.isFinite(out) ? out : 0;
}

// =====================
// ELO (separat från SCORE)
// =====================
// - Elo uppdateras ENDAST för riktiga 1v1-matcher (ej Öva, ej bot, ej walkover)
// - Provisional: snabbare rörlighet första 10 rated-matcher
// - ELO ska inte påverka SCORE. Det är ett separat spår.

function eloExpected(rA, rB) {
  // Standard Elo expected score
  const A = Number.isFinite(rA) ? rA : 1000;
  const B = Number.isFinite(rB) ? rB : 1000;
  return 1 / (1 + Math.pow(10, (B - A) / 400));
}

function eloOutcome(myName, winnerName) {
  // 1 = vinst, 0 = förlust, 0.5 = oavgjort
  if (!winnerName) return 0.5;
  return myName === winnerName ? 1 : 0;
}

function eloKFactor(eloPlayed) {
  const n = Number.isFinite(eloPlayed) ? eloPlayed : 0;
  return n < 10 ? 40 : 24;
}

async function hasTable(dbClient, tableName) {
  const key = `__table__.${tableName}`;
  if (_colCache.has(key)) return _colCache.get(key);
  const { rows } = await dbClient.query(
    `select 1
     from information_schema.tables
     where table_schema='public' and table_name=$1
     limit 1`,
    [tableName]
  );
  const ok = rows.length > 0;
  _colCache.set(key, ok);
  return ok;
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
      // ELO (separat rating-spår)
      "elo_rating",
      "elo_played",
      "elo_peak",
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

// =====================
// Guest "Try" session (Login -> Prova)
// =====================
// Creates a temporary session without creating a user row.
// This session can play a solo practice match, but does not store progression.
app.post("/api/guest", authLimiter, async (req, res) => {
  try {
    const username = makeGuestUsername();

    // NOTE:
    // In some DB setups, sessions.username has a FK to users.username.
    // To keep "Prova" robust we ensure a minimal user row exists for the guest.
    // The guest row is removed on logout (see /api/logout).
    const client = await pool.connect();
    try {
      const { rows } = await client.query("select 1 from users where username=$1", [username]);
      if (!rows?.length) {
        const pw = await hashPasswordModern(crypto.randomBytes(16).toString("hex"));
        const okHidden = await hasColumn(client, "users", "hidden");
        if (okHidden) {
          await client.query(
            "insert into users (username, password_hash, hidden) values ($1,$2,true) on conflict (username) do nothing",
            [username, pw]
          );
        } else {
          await client.query(
            "insert into users (username, password_hash) values ($1,$2) on conflict (username) do nothing",
            [username, pw]
          );
        }
      }
    } finally {
      client.release();
    }

    const sessionId = await createSession(username);
    res.json({ sessionId, username, isGuest: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

app.post("/api/logout", authMiddleware, async (req, res) => {
  try {
    // ✅ Ta bort både aktuell session och ev. kvarlämnade duplicerade sessions för samma användare.
    // Detta hjälper även att "städa" gamla tab-sessions som skapats innan 1-session-regeln var införd.
    await pool.query("delete from sessions where id=$1 or username=$2", [
      req.sessionId,
      req.username,
    ]);

    // If this is a guest session, remove the temporary guest user row.
    // (Only if no other sessions still exist for that guest username.)
    if (isGuestUsername(req.username)) {
      try {
        const { rows } = await pool.query(
          "select count(*)::int as c from sessions where username=$1",
          [req.username]
        );
        const c = Number(rows?.[0]?.c ?? 0);
        if (c === 0) {
          await pool.query("delete from users where username=$1", [req.username]);
        }
      } catch (_) {
        // ignore cleanup failures
      }
    }

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

    const optional = ["level", "xp_total", "xp_updated_at", "badges_count", "best_match_score",
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
    const xpTotalRaw = Object.prototype.hasOwnProperty.call(u, "xp_total") ? u.xp_total : null;
    const xpTotal =
      xpTotalRaw == null ? null : typeof xpTotalRaw === "number" ? xpTotalRaw : Number(xpTotalRaw);
    const xpUpdatedAt = Object.prototype.hasOwnProperty.call(u, "xp_updated_at") ? u.xp_updated_at : null;


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
      xp_total: Number.isFinite(xpTotal) ? xpTotal : null,
      xpTotal: Number.isFinite(xpTotal) ? xpTotal : null,
      xp_updated_at: xpUpdatedAt ?? null,
      xpUpdatedAt: xpUpdatedAt ?? null,
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

    const optional = ["level", "xp_total", "xp_updated_at", "badges_count", "best_match_score",
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
    const xpTotalRaw = Object.prototype.hasOwnProperty.call(u, "xp_total") ? u.xp_total : null;
    const xpTotal =
      xpTotalRaw == null ? null : typeof xpTotalRaw === "number" ? xpTotalRaw : Number(xpTotalRaw);
    const xpUpdatedAt = Object.prototype.hasOwnProperty.call(u, "xp_updated_at") ? u.xp_updated_at : null;


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
      xp_total: Number.isFinite(xpTotal) ? xpTotal : null,
      xpTotal: Number.isFinite(xpTotal) ? xpTotal : null,
      xp_updated_at: xpUpdatedAt ?? null,
      xpUpdatedAt: xpUpdatedAt ?? null,
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
  const client = await pool.connect();
  try {
    const mode = normalizeDifficulty(req.query.mode || "total");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50) || 50));

    // total är inte en difficulty i normalizeDifficulty, så special-case:
    const modeKey = String(req.query.mode || "total").trim().toLowerCase() === "total" ? "total" : mode;

    const prefix = modeKey === "easy" ? "e_" : modeKey === "medium" ? "m_" : modeKey === "hard" ? "s_" : "t_";

    const sortRaw = String(req.query.sort || "ppm").trim().toLowerCase();
    const dirRaw = String(req.query.dir || "").trim().toLowerCase();

    // sort:
    // - ppm/pct/sp/vm/fm: från leaderboard_wide (kolumner per difficulty)
    // - score: server-beräknad (anti-easy-farm) → sorteras i JS
    // - elo: från users.elo_rating (joinas in ovan) → sorteras i SQL
    const allowedSort = new Set(["ppm", "pct", "sp", "vm", "fm", "score", "elo"]);
    const sort = allowedSort.has(sortRaw) ? sortRaw : "ppm";

    // ELO-kolumner kan saknas (om du inte har migrerat DB än).
    // Vi kollar detta tidigt så att sort=elo kan ge ett tydligt fel.
    const hasElo = await hasColumn(client, "users", "elo_rating");
    const hasEloPlayed = await hasColumn(client, "users", "elo_played");

    // Default direction per sort
    const defaultDir =
      sort === "pct" || sort === "vm" || sort === "score" || sort === "elo" ? "desc" : "asc";
    const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir;

    // score är en server-beräknad kolumn (anti-easy-farm). Vi hämtar en större mängd rader och sorterar i JS.
    // elo sorteras på users.elo_rating (join i selectSql).
    const isScoreSort = sort === "score";
    const isEloSort = sort === "elo";

    if (isEloSort && !hasElo) {
      return res.status(400).json({ error: "ELO is not enabled" });
    }

    const col = isScoreSort || isEloSort ? null : `${prefix}${sort}`;
    // Vid score/elo vill vi visa globalt (total) istället för per-difficulty.
    const playedCol = isScoreSort || isEloSort ? "t_sp" : `${prefix}sp`;

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

    if (!allowedCols.has(playedCol)) {
      return res.status(400).json({ error: "Ogiltiga sort-parametrar" });
    }

    if (!isScoreSort && !isEloSort && !allowedCols.has(col)) {
      return res.status(400).json({ error: "Ogiltiga sort-parametrar" });
    }

    // För score-sort hämtar vi fler rader för att kunna sortera rätt efter beräkningen.
    const sqlLimit = isScoreSort ? Math.max(limit, 120) : limit;

    const selectSql = hasElo
      ? `select lb.*, u.elo_rating${hasEloPlayed ? ", u.elo_played" : ""}
         from public.leaderboard_wide lb
         left join public.users u on u.username = lb.namn`
      : `select lb.*
         from public.leaderboard_wide lb`;

    const colRef = isScoreSort ? null : isEloSort ? "u.elo_rating" : `lb.${col}`;
    const playedRef = `lb.${playedCol}`;
    // Vid score/elo vill vi alltid använda total-träffsäkerhet som tie-breaker
    const pctRef = isScoreSort || isEloSort ? "lb.t_pct" : `lb.${prefix}pct`;

      // Server-side filter to keep the leaderboard clean:
      // - Must have played at least 3 matches (overall)
      // - Must have ELO participation (elo_played > 0) and not be behind played
      // - Must have reasonable PPM (0 < t_ppm < 15000)
      const eloIntegrityFilter = hasEloPlayed
        ? `
          and coalesce(u.elo_played, 0) > 0
          and coalesce(u.elo_played, 0) >= lb.t_sp
        `
        : hasElo
          ? `
            and u.elo_rating is not null
          `
          : "";

		const antiFakeFilter = `
		  and lb.t_sp >= 3
		  and lb.t_ppm is not null
		  and lb.t_ppm <> 0
		  and lb.t_ppm < 15000
		`;

    const { rows: rawRows } = await client.query(
      isScoreSort
        ? `${selectSql}
           where coalesce(lb.hidden,false) = false
             and ${playedRef} > 0
             ${antiFakeFilter}
           order by lb.namn asc
           limit $1`
        : `${selectSql}
           where coalesce(lb.hidden,false) = false
             and ${playedRef} > 0
             ${antiFakeFilter}
           order by
             ${colRef} ${dir} nulls last,
             ${pctRef} desc nulls last,
             ${playedRef} desc,
             lb.namn asc
           limit $1`,
      [sqlLimit]
    );

    

    // Attach recent ELO results (last up to 3) per player for a small trend icon in the UI
    let eloRecentMap = new Map();
    try {
      const usernames = Array.from(new Set((rawRows || []).map((r) => r?.namn).filter(Boolean)));
      if (usernames.length > 0) {
        const { rows: recentRows } = await client.query(
          `with per as (
             select p1 as username, created_at, outcome::int as res
             from public.elo_log
             union all
             select p2 as username, created_at, (1 - outcome)::int as res
             from public.elo_log
           ), ranked as (
             select username, res, created_at,
                    row_number() over (partition by username order by created_at desc) as rn
             from per
             where username = any($1::text[])
           )
           select username, array_agg(res order by created_at desc) as recent
           from ranked
           where rn <= 3
           group by username`,
          [usernames]
        );

        for (const rr of recentRows || []) {
          if (rr?.username) eloRecentMap.set(rr.username, rr.recent);
        }
      }
    } catch (e) {
      // If elo_log doesn't exist (yet) or any other issue, ignore so leaderboard still works
    }
// Beräkna och attach:a SCORE
    const rows = (rawRows || []).map((r) => ({ ...r, score: computeLeaderboardScore(r), elo_recent: eloRecentMap.get(r?.namn) || null }));

    if (isScoreSort) {
      rows.sort((a, b) => {
        const sa = _toFiniteNum(a?.score, 0);
        const sb = _toFiniteNum(b?.score, 0);
        if (sb !== sa) return sb - sa; // desc
        // tie-breakers
        const pctA = _toFiniteNum(a?.t_pct, -1);
        const pctB = _toFiniteNum(b?.t_pct, -1);
        if (pctB !== pctA) return pctB - pctA;
        const spA = _toFiniteNum(a?.t_sp, 0);
        const spB = _toFiniteNum(b?.t_sp, 0);
        if (spB !== spA) return spB - spA;
        return String(a?.namn || "").localeCompare(String(b?.namn || ""));
      });
    }

    res.json({ mode: modeKey, sort, dir, rows: rows.slice(0, limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

// =====================
// Feedback (Bug report / Feature request) -> public.feedback_reports
// =====================
const ADMIN_USERNAME = "Toffaboffa";
const FEEDBACK_ADMIN_USERNAME = ADMIN_USERNAME;

function normalizeFeedbackKind(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "bug" || s === "feature") return s;
  return null;
}

app.post("/api/feedback", authMiddleware, async (req, res) => {
  const username = req.username;
  const kind = normalizeFeedbackKind(req.body?.kind);
  const message = String(req.body?.message || "").trim();

  const pageUrl = req.body?.pageUrl ? String(req.body.pageUrl).slice(0, 1000) : null;
  const userAgent = req.body?.userAgent ? String(req.body.userAgent).slice(0, 1000) : null;
  const lang = req.body?.lang ? String(req.body.lang).slice(0, 32) : null;

  let meta = req.body?.meta ?? {};
  if (meta && typeof meta !== "object") meta = { value: meta };

  if (!kind) return res.status(400).json({ error: "Ogiltig typ" });
  if (!message) return res.status(400).json({ error: "Meddelande saknas" });
  if (message.length > 8000) return res.status(400).json({ error: "Meddelandet är för långt" });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `insert into public.feedback_reports
        (username, kind, message, page_url, user_agent, lang, meta)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)
       returning id, created_at`,
      [username, kind, message, pageUrl, userAgent, lang, JSON.stringify(meta || {})]
    );

    res.json({ ok: true, item: rows?.[0] ?? null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
  }
});

app.get("/api/feedback", authMiddleware, async (req, res) => {
  if (req.username !== FEEDBACK_ADMIN_USERNAME) return res.status(403).json({ error: "Forbidden" });

  const kind = normalizeFeedbackKind(req.query?.kind);
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));

  const client = await pool.connect();
  try {
    if (kind) {
      const { rows } = await client.query(
        `select id, created_at, username, kind, message, page_url, lang
         from public.feedback_reports
         where kind=$1
         order by created_at desc
         limit $2`,
        [kind, limit]
      );
      return res.json({ ok: true, rows });
    }

    const { rows } = await client.query(
      `select id, created_at, username, kind, message, page_url, lang
       from public.feedback_reports
       order by created_at desc
       limit $1`,
      [limit]
    );
    res.json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  } finally {
    client.release();
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

// Users who have chosen to hide from the public online list.
// NOTE: This is intentionally kept in-memory (no DB migration needed).
// It will reset on server restart.
const hiddenOnlineUsers = new Set();

// --- Simple in-memory daily stats for admin sidebar (Stockholm local date) ---
function stockholmDateKey(d = new Date()) {
  // YYYY-MM-DD in Europe/Stockholm
  const s = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  return s; // already YYYY-MM-DD
}

let _dailyStats = {
  dateKey: stockholmDateKey(),
  loggedInUsers: new Set(),
  soloGames: 0,
  pvpGames: 0,
  trialGames: 0,
};

// --- DB-backed daily stats cache (survives server restarts / multi-instance) ---
// We refresh this periodically and use it in the admin sidebar.
let _adminStatsCache = {
  updatedAtMs: 0,
  stats: {
    loggedInToday: 0,
    soloToday: 0,
    pvpToday: 0,
    trialToday: 0,
  },
};

async function refreshAdminStatsCache() {
  const client = await pool.connect();
  try {
    // Check which columns exist (compat-safe)
    const hasXpCreatedAt = await hasColumn(client, "xp_events", "created_at");
    const hasSessionsLastSeen = await hasColumn(client, "sessions", "last_seen");
    const hasSessionsCreatedAt = await hasColumn(client, "sessions", "created_at");

    // Fallback: in-memory stats (works but resets on restart)
    if (!hasXpCreatedAt) {
      tickDailyStats();
      _adminStatsCache = {
        updatedAtMs: Date.now(),
        stats: {
          loggedInToday: _dailyStats.loggedInUsers.size,
          soloToday: _dailyStats.soloGames,
          pvpToday: _dailyStats.pvpGames,
          trialToday: _dailyStats.trialGames,
        },
      };
      return;
    }

    // Midnight in Europe/Stockholm (as timestamptz)
    const dayStartSql =
      "(date_trunc('day', now() AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'Europe/Stockholm')";

    // "Logged in today" = distinct users with activity today (prefer last_seen)
    let loggedInToday = 0;
    if (hasSessionsLastSeen) {
      const { rows } = await client.query(
        `select count(distinct username)::int as n from sessions where last_seen >= ${dayStartSql}`
      );
      loggedInToday = Number(rows?.[0]?.n ?? 0);
    } else if (hasSessionsCreatedAt) {
      const { rows } = await client.query(
        `select count(distinct username)::int as n from sessions where created_at >= ${dayStartSql}`
      );
      loggedInToday = Number(rows?.[0]?.n ?? 0);
    } else {
      // last resort
      tickDailyStats();
      loggedInToday = _dailyStats.loggedInUsers.size;
    }

    // PvP matches today: two match_xp rows per match -> count distinct match_id
    const { rows: pvpRows } = await client.query(
      `select count(distinct match_id)::int as n
       from xp_events
       where reason = 'match_xp'
         and created_at >= ${dayStartSql}`
    );
    const pvpToday = Number(pvpRows?.[0]?.n ?? 0);

    // Solo practice today (excluding guests): one practice_xp per match -> count distinct match_id
    const { rows: soloRows } = await client.query(
      `select count(distinct match_id)::int as n
       from xp_events
       where reason = 'practice_xp'
         and username not like '__guest__%'
         and created_at >= ${dayStartSql}`
    );
    const soloToday = Number(soloRows?.[0]?.n ?? 0);

    // Trial practice today (guests)
    const { rows: trialRows } = await client.query(
      `select count(distinct match_id)::int as n
       from xp_events
       where reason = 'practice_xp'
         and username like '__guest__%'
         and created_at >= ${dayStartSql}`
    );
    const trialToday = Number(trialRows?.[0]?.n ?? 0);

    _adminStatsCache = {
      updatedAtMs: Date.now(),
      stats: { loggedInToday, soloToday, pvpToday, trialToday },
    };
  } catch (e) {
    // Don't break the server if stats fail
    console.error("refreshAdminStatsCache failed", e);
  } finally {
    client.release();
  }
}

// Refresh every 30s (best effort)
setInterval(() => {
  refreshAdminStatsCache().catch(() => {});
}, 30_000).unref?.();
refreshAdminStatsCache().catch(() => {});

function ensureDailyStats() {
  const key = stockholmDateKey();
  if (key !== _dailyStats.dateKey) {
    _dailyStats = { dateKey: key, loggedInUsers: new Set(), soloGames: 0, pvpGames: 0, trialGames: 0 };
  }
  return _dailyStats;
}

// Alias used throughout the codebase
function tickDailyStats() {
  ensureDailyStats();
}

const socketsByUser = new Map(); // username -> Set(socket.id)
const userBySocket = new Map(); // socket.id -> username
const matches = new Map(); // matchId -> match

// --- Session cleanup tracking (supports multiple tabs sharing the same sessionId) ---
const socketsBySession = new Map(); // sessionId -> Set(socket.id)
const sessionBySocket = new Map(); // socket.id -> sessionId

const activeMatchByUser = new Map(); // username -> matchId
// username -> { timeoutId, untilMs, matchId }
const disconnectGrace = new Map();
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

function getAnySocketId(username) {
  const set = socketsByUser.get(username);
  if (!set || set.size === 0) return null;
  return set.values().next().value;
}

function addSocketForUser(username, socketId) {
  const u = String(username || '').trim();
  if (!u) return;
  let set = socketsByUser.get(u);
  if (!set) {
    set = new Set();
    socketsByUser.set(u, set);
  }
  const wasEmpty = set.size === 0;
  set.add(socketId);
  userBySocket.set(socketId, u);
  if (wasEmpty) lobby.onlineUsers.add(u);
}

function removeSocketForUser(username, socketId) {
  const u = String(username || '').trim();
  if (!u) return;
  const set = socketsByUser.get(u);
  if (set) set.delete(socketId);
  userBySocket.delete(socketId);
  if (set && set.size === 0) {
    socketsByUser.delete(u);
    lobby.onlineUsers.delete(u);
    removeUserFromAllQueues(u);
  }
}

function removeSocket(socketId) {
  const u = userBySocket.get(socketId);
  if (!u) return;
  untrackSessionSocket(socketId);
  removeSocketForUser(u, socketId);
}

function broadcastLobby() {
  // Online count should reflect ALL connected real users (guests excluded),
  // even if someone opted to hide from the list.
  const realOnlineUsers = Array.from(lobby.onlineUsers)
    .filter((u) => !isGuestUsername(u))
    .sort((a, b) => a.localeCompare(b));

  // Public online list should not show users who opted to hide.
  const visibleOnlineUsersSorted = realOnlineUsers
    .filter((u) => !hiddenOnlineUsers.has(u));

  // Base lobby payload (sent to everyone)
  const base = {
    // Count = all real users online (incl. hidden), List = visible users only
    onlineCount: realOnlineUsers.length,
    onlineUsers: visibleOnlineUsersSorted,
    queueCounts: getQueueCounts(),
  };

  // Admin-only extras (stats)
  tickDailyStats();
  const admin = {
    onlineUsers: visibleOnlineUsersSorted,
    stats: _adminStatsCache?.stats || {
      loggedInToday: _dailyStats.loggedInUsers.size,
      soloToday: _dailyStats.soloGames,
      pvpToday: _dailyStats.pvpGames,
      trialToday: _dailyStats.trialGames,
    },
  };

  // Send per-socket so only admin receives the admin block
  for (const socketId of userBySocket.keys()) {
    const user = userBySocket.get(socketId);
    const payload = user === ADMIN_USERNAME ? { ...base, admin } : base;
    io.to(socketId).emit("lobby_state", payload);
  }
}



function pruneLobbyPresence() {
  let changed = false;

  // Prune socketIds that are no longer live, and collapse empty users.
  for (const [user, set] of Array.from(socketsByUser.entries())) {
    for (const sid of Array.from(set)) {
      const s = sid ? io.sockets.sockets.get(sid) : null;
      if (!s || s.disconnected) {
        set.delete(sid);
        userBySocket.delete(sid);
        changed = true;
      }
    }
    if (set.size === 0) {
      socketsByUser.delete(user);
      lobby.onlineUsers.delete(user);
      removeUserFromAllQueues(user);
      changed = true;
    }
  }

  // Prune orphan reverse mappings too (defensive).
  for (const [sid, user] of Array.from(userBySocket.entries())) {
    const s = sid ? io.sockets.sockets.get(sid) : null;
    if (!s || s.disconnected) {
      userBySocket.delete(sid);
      const set = socketsByUser.get(user);
      if (set) {
        set.delete(sid);
        if (set.size === 0) {
          socketsByUser.delete(user);
          lobby.onlineUsers.delete(user);
          removeUserFromAllQueues(user);
        }
      }
      changed = true;
    }
  }

  if (changed) broadcastLobby();
}

// Socket.io will usually detect disconnects on its own, but real networks are weird.
// This sweep keeps lobby online-count honest even if a client disappears without a clean disconnect.
setInterval(pruneLobbyPresence, 15000);
// =====================
// Lobby chat (ephemeral, 15 min TTL)
// =====================
const LOBBY_CHAT_TTL_MS = 15 * 60 * 1000;
const LOBBY_CHAT_MAX = 200; // säkerhetsgräns i minnet
const lobbyChat = []; // { id, ts, user, level, text }

// Minimal level-cache för chatten (undviker DB-hit på varje msg)
const _userLevelCache = new Map(); // username -> { level, ts }
const _USER_LEVEL_CACHE_TTL_MS = 60 * 1000;

async function getUserLevelSafe(username) {
  const key = String(username || "");
  const cached = _userLevelCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < _USER_LEVEL_CACHE_TTL_MS) return cached.level;

  let level = null;
  const client = await pool.connect();
  try {
    const hasLevel = await hasColumn(client, "users", "level");
    if (!hasLevel) {
      level = null;
    } else {
      const { rows } = await client.query("select level from users where username=$1 limit 1", [key]);
      const v = rows?.[0]?.level;
      const n = Number(v);
      level = Number.isFinite(n) ? n : null;
    }
  } catch {
    level = null;
  } finally {
    client.release();
  }

  _userLevelCache.set(key, { level, ts: now });
  return level;
}

function pruneLobbyChat(now = Date.now()) {
  const cutoff = now - LOBBY_CHAT_TTL_MS;
  while (lobbyChat.length && lobbyChat[0].ts < cutoff) lobbyChat.shift();

  // extra safety: håll max storlek även om det blir spam
  if (lobbyChat.length > LOBBY_CHAT_MAX) {
    lobbyChat.splice(0, lobbyChat.length - LOBBY_CHAT_MAX);
  }
}

function getLobbyChatSnapshot() {
  pruneLobbyChat();
  return lobbyChat.slice(-LOBBY_CHAT_MAX);
}

// Purge-loop (tyst, bara för minne/TTL)
setInterval(() => pruneLobbyChat(), 30 * 1000);


function clearDisconnectGrace(username) {
  const entry = disconnectGrace.get(username);
  const timeoutId = entry && typeof entry === "object" ? entry.timeoutId : entry;
  if (timeoutId) clearTimeout(timeoutId);
  disconnectGrace.delete(username);
}

function getRetryAfterMs(username) {
  const entry = disconnectGrace.get(username);
  const untilMs = entry && typeof entry === "object" ? Number(entry.untilMs) : null;
  if (!Number.isFinite(untilMs)) return 0;
  return Math.max(0, untilMs - nowMs());
}

function getActiveMatchIdSafe(username) {
  const matchId = activeMatchByUser.get(username);
  if (!matchId) return null;
  const match = matches.get(matchId);
  if (!match || match.finished) {
    activeMatchByUser.delete(username);
    clearDisconnectGrace(username);
    return null;
  }
  return matchId;
}

function isUserInActiveMatch(username) {
  return !!getActiveMatchIdSafe(username);
}

function emitAlreadyInMatch(socket, eventName, username) {
  const retryAfterMs = getRetryAfterMs(username);
  if (retryAfterMs > 0) {
    socket.emit(eventName, { message: "Du är redan i en match.", retryAfterMs });
  } else {
    socket.emit(eventName, "Du är redan i en match.");
  }
}

function createMatch(playerA, playerB, opts = {}) {
  const matchId = crypto.randomBytes(8).toString("hex");
  const scorer = createRoundScorer(SCORER_MAX_DISTANCE_KM, SCORER_MAX_TIME_MS, {
  distPoints: 1000,
  timePoints: 1000,
  timeCurve: "exp",
  timeK: 3.2,
});

  const match = {
    id: matchId,
    createdAt: nowMs(),
    finishedAt: null,
    finishReason: null,
    players: [playerA, playerB],
    currentRound: 0,
    totalRounds: 10,
    rounds: [],
    // city selection: without replacement within a match
    usedCityKeys: new Set(),
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

  // Daily stats (admin panel) – count only real PvP games
  if (pA !== BOT_NAME && pB !== BOT_NAME) {
    tickDailyStats();
    _dailyStats.pvpGames += 1;
  }

  removeUserFromAllQueues(pA);
  removeUserFromAllQueues(pB);
  broadcastLobby();

  setActiveMatchForPlayers(match);

  const room = getRoomName(match.id);

  const sA = getAnySocketId(pA);
  const sB = getAnySocketId(pB);
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

function wrapLon180(lon) {
  // Normalisera lon till intervallet [-180, 180]
  const x = ((Number(lon) + 180) % 360 + 360) % 360 - 180;
  return x;
}

function antipodeLonLat(lon, lat) {
  // Antipod: punkt på motsatta sidan av jorden (≈ maxdistans)
  return [wrapLon180(Number(lon) + 180), -Number(lat)];
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

	// ✅ SISTA RUNDAN? Då ska vi INTE visa "ready_prompt" eller "Nästa runda om..."
	if (match.currentRound >= match.totalRounds - 1) {
	  setTimeout(() => {
		finishMatch(match).catch(() => {});
	  }, 1200); // liten delay så round_result hinner visas
	  return;
	}

	match.readyPromptTimeout = setTimeout(() => {
	  io.to(room).emit("ready_prompt", { roundIndex: match.currentRound });
	}, 2000);

	match.readyTimeout = setTimeout(() => {
	  startNextRoundCountdown(match);
	}, 10_000);
}

function startNextRoundCountdown(match) {
  if (!match || match.finished) return;

  // ✅ Skydd: om countdown redan är igång, starta inte en till
  if (match._countdownRunning) return;
  match._countdownRunning = true;

  // ✅ SISTA RUNDAN? Ingen countdown alls.
  if (match.currentRound >= match.totalRounds - 1) {
    match._countdownRunning = false;
    finishMatch(match).catch(() => {});
    return;
  }

  clearTimeout(match.readyPromptTimeout);
  clearTimeout(match.readyTimeout);

  const room = getRoomName(match.id);
  match.awaitingReady = false;
  match.ready.clear();

  const seconds = 6;
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
// Start-ready: countdown before FIRST round
// =====================
function startInitialRoundCountdown(match) {
  if (!match || match.finished) return;

  // ✅ Same countdown overlay/event as between rounds
  if (match._countdownRunning) return;
  match._countdownRunning = true;

  const room = getRoomName(match.id);

  const seconds = 5;
  io.to(room).emit("next_round_countdown", { seconds });

  clearTimeout(match.countdownTimeout);
  match.countdownTimeout = setTimeout(() => {
    match._countdownRunning = false;

    // First round: do NOT change currentRound here (it should already be 0)
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

  // ✅ City-val utan återläggning (ingen stad två gånger i samma match)
  //    Key = name|countryCode (samma som för capitals-markering)
  const used = match.usedCityKeys || (match.usedCityKeys = new Set());
  const cityKey = (c) =>
    `${String(c?.name || "").trim().toLowerCase()}|${String(c?.countryCode || "")
      .trim()
      .toUpperCase()}`;

  // ✅ Välj en stad med giltiga koordinater + som inte använts i matchen
  let city = null;
  for (let i = 0; i < 250; i++) {
    const candidate = poolList[Math.floor(Math.random() * poolList.length)];
    const lat = Number(candidate?.lat);
    const lon = Number(candidate?.lon);
    const key = cityKey(candidate);

    if (!key.split("|")[0] || !key.split("|")[1]) continue;
    if (used.has(key)) continue;

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      city = candidate;
      used.add(key);
      break;
    }
  }

  // Fallback: filtrera fram återstående städer (bör nästan aldrig behövas)
  if (!city) {
    const remaining = poolList.filter((c) => {
      const key = cityKey(c);
      const lat = Number(c?.lat);
      const lon = Number(c?.lon);
      return (
        key.split("|")[0] &&
        key.split("|")[1] &&
        !used.has(key) &&
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      );
    });

    if (remaining.length) {
      city = remaining[Math.floor(Math.random() * remaining.length)];
      used.add(cityKey(city));
    }
  }

  // Sista fallback (extremt osannolikt om totalRounds är liten): välj ändå från pool
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
        const [pLon, pLat] = antipodeLonLat(city.lon, city.lat);
        r.clicks[p] = calculateClick(city, pLon, pLat, PENALTY_TIME_MS, match.scorer);
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

  const hasEasyPlayed = await hasColumn(dbClient, "users", "easy_played");
  const hasMediumPlayed = await hasColumn(dbClient, "users", "medium_played");
  const hasHardPlayed = await hasColumn(dbClient, "users", "hard_played");

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
  if (hasEasyPlayed) selectCols.push("easy_played");
  if (hasMediumPlayed) selectCols.push("medium_played");
  if (hasHardPlayed) selectCols.push("hard_played");
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
      easy_played: 0,
      medium_played: 0,
      hard_played: 0,
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
        },
        playedByDifficulty: {
          easy: hasEasyPlayed ? Number(user.easy_played ?? 0) : null,
          medium: hasMediumPlayed ? Number(user.medium_played ?? 0) : null,
          hard: hasHardPlayed ? Number(user.hard_played ?? 0) : null,
        },
        playedChallengesTotal: hasPlayedChallengesTotal ? Number(user.played_challenges_total ?? 0) : null,
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

// badges_count sync (om kolumn finns)
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

// Uppdatera endast badges_count här.
// Level ska framöver baseras ENDAST på XP (users.xp_total) och uppdateras i XP-flödet.
if (hasBadgesCount) {
  await dbClient.query(`update users set badges_count = $2 where username = $1`, [username, newBadgesCount]);
}

// Level hanteras inte längre här (XP-systemet är källan till sanning)
const newLevel = oldLevel;

// Badge bonus XP: summa xp_bonus för badges som låstes upp i denna match.
// (Skrivs inte här – bara beräknas och returneras till finishMatch/XP-flödet.)
let badgeBonusXp = 0;
if (newlyInsertedCodes.length) {
  let sum = 0;
  let missing = false;
  for (const c of newlyInsertedCodes) {
    const b = byCode.get(c);
    const x = Number(b?.xpBonus);
    if (Number.isFinite(x)) sum += x;
    else missing = true;
  }
  if (!missing) {
    badgeBonusXp = Math.round(sum);
  } else {
    // Fallback om katalogen inte innehåller xpBonus
    const { rows: bonusRows } = await dbClient.query(
      `select coalesce(sum(coalesce(xp_bonus,0)),0)::int as s
       from public.badges
       where code = any($1::text[])`,
      [newlyInsertedCodes]
    );
    badgeBonusXp = Number(bonusRows?.[0]?.s ?? 0);
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
  newBadgeCodes: newlyInsertedCodes,
  badgeBonusXp,
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



// =====================
// XP + Level (Steg 2: practice XP)
// =====================
const XP_P = 40; // spelad-bas (P), justerbart
const XP_MAX_PERF = 0.5; // upp till +50%
const XP_PRACTICE_MULT = 0.07; // 7% för öva/solo

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function difficultyFactor(difficulty) {
  const d = String(difficulty || "").toLowerCase();
  if (d === "easy") return 1;
  if (d === "medium") return 1.8;
  if (d === "hard") return 3;
  return 1;
}

function computePerfMult(totalScore, roundsCount) {
  const rc = Math.max(1, Number(roundsCount || 1));
  const scoreMax = 2000 * rc;
  const q = clamp01(1 - Number(totalScore || 0) / scoreMax); // lägre score = bättre
  return 1 + XP_MAX_PERF * (q * q);
}

// Level-kurva: need(L) = 180 + 40L + 6L^2
function xpNeedForNextLevel(L) {
  const l = Math.max(0, Math.floor(Number(L || 0)));
  return 180 + 40 * l + 6 * l * l;
}

function levelFromXpTotal(xpTotal) {
  const total = Math.max(0, Math.floor(Number(xpTotal || 0)));
  let level = 0;
  let base = 0;

  while (true) {
    const need = xpNeedForNextLevel(level);
    if (total < base + need) break;
    base += need;
    level += 1;
    if (level > 10_000) break; // skydd
  }

  const nextNeed = xpNeedForNextLevel(level);
  const nextAt = base + nextNeed;
  const into = total - base;
  const toNext = Math.max(0, nextAt - total);
  const pct = nextNeed > 0 ? (into / nextNeed) * 100 : 0;

  return {
    level,
    xpLevelBase: base,
    xpNextLevelAt: nextAt,
    xpIntoLevel: into,
    xpToNext: toNext,
    xpPctToNext: Math.max(0, Math.min(100, pct)),
  };
}

// Liten kolumn-cache (minskar hasColumn-spam)
const _xpColCache = new Map(); // key: "table.col" -> boolean
async function hasColCached(dbClient, table, col) {
  const k = `${table}.${col}`;
  if (_xpColCache.has(k)) return _xpColCache.get(k);
  const v = await hasColumn(dbClient, table, col);
  _xpColCache.set(k, v);
  return v;
}

// Idempotent XP-write (ON CONFLICT) + users.xp_total (+level)
async function applyXpOnceTx(dbClient, { username, matchId, reason, amount, meta }) {
  const u = String(username || "").trim();
  const mId = String(matchId || "").trim();
  const r = String(reason || "").trim();
  const amt = Math.max(0, Math.floor(Number(amount || 0)));

  if (!u || !mId || !r || amt <= 0) {
    return { inserted: false, oldXpTotal: null, newXpTotal: null, oldLevel: null, newLevel: null };
  }

  const hasXpTotal = await hasColCached(dbClient, "users", "xp_total");
  if (!hasXpTotal) {
    // DB saknar XP-kolumner → gör inget (men krascha inte servern)
    return { inserted: false, oldXpTotal: null, newXpTotal: null, oldLevel: null, newLevel: null };
  }

  const hasLevel = await hasColCached(dbClient, "users", "level");
  const hasXpUpdatedAt = await hasColCached(dbClient, "users", "xp_updated_at");

  // Läs "före" (för UI delta)
  let oldXpTotal = 0;
  let oldLevel = 0;
  try {
    const selCols = ["coalesce(xp_total,0)::bigint as xp_total"];
    if (hasLevel) selCols.push("coalesce(level,0)::int as level");
    const { rows } = await dbClient.query(
      `select ${selCols.join(", ")} from users where username = $1 for update`,
      [u]
    );
    oldXpTotal = Number(rows?.[0]?.xp_total ?? 0);
    oldLevel = hasLevel ? Number(rows?.[0]?.level ?? 0) : 0;
  } catch (e) {
    console.error("applyXpOnceTx select users failed", e);
  }

  // Bygg INSERT dynamiskt så vi inte kräver meta/created_at-kolumner
  const hasMeta = await hasColCached(dbClient, "xp_events", "meta");
  const hasCreatedAt = await hasColCached(dbClient, "xp_events", "created_at");
  const hasAmount = await hasColCached(dbClient, "xp_events", "amount");
  const hasXpAmount = !hasAmount && (await hasColCached(dbClient, "xp_events", "xp_amount"));

  const hasMode = await hasColCached(dbClient, "xp_events", "mode");
  const hasDifficulty = await hasColCached(dbClient, "xp_events", "difficulty");

  const amountCol = hasAmount ? "amount" : hasXpAmount ? "xp_amount" : null;
  if (!amountCol) {
    console.error("xp_events saknar amount/xp_amount kolumn – kan inte skriva XP");
    return { inserted: false, oldXpTotal, newXpTotal: oldXpTotal, oldLevel, newLevel: oldLevel };
  }

  const cols = ["username", "match_id", "reason", amountCol];
  const vals = ["$1", "$2", "$3", "$4"];
  const params = [u, mId, r, amt];
  let p = 5;

  if (hasMeta) {
    cols.push("meta");
    vals.push(`$${p++}::jsonb`);
    params.push(JSON.stringify(meta || {}));
  }

if (hasMode) {
  cols.push("mode");
  vals.push(`$${p++}`);
  const m = meta && typeof meta === "object" ? meta.mode : null;
  params.push(m != null ? String(m) : "unknown");
}
if (hasDifficulty) {
  cols.push("difficulty");
  vals.push(`$${p++}`);
  const d = meta && typeof meta === "object" ? meta.difficulty : null;
  params.push(d != null ? String(d) : DEFAULT_DIFFICULTY);
}
  if (hasCreatedAt) {
    cols.push("created_at");
    vals.push("now()");
  }

  let inserted = false;
  try {
    const q = `
      insert into public.xp_events (${cols.join(", ")})
      values (${vals.join(", ")})
      on conflict (username, match_id, reason) do nothing
      returning 1 as ok
    `;
    const { rows } = await dbClient.query(q, params);
    inserted = !!rows?.length;
  } catch (e) {
    console.error("applyXpOnceTx insert xp_events failed", e);
    inserted = false;
  }

  let newXpTotal = oldXpTotal;
  let newLevel = oldLevel;

  if (inserted) {
    try {
      const sets = [`xp_total = coalesce(xp_total,0) + $2`];
      const upParams = [u, amt];
      if (hasXpUpdatedAt) sets.push(`xp_updated_at = now()`);

      const retCols = ["coalesce(xp_total,0)::bigint as xp_total"];
      if (hasLevel) retCols.push("coalesce(level,0)::int as level");

      const { rows } = await dbClient.query(
        `update users set ${sets.join(", ")} where username = $1 returning ${retCols.join(", ")}`,
        upParams
      );

      newXpTotal = Number(rows?.[0]?.xp_total ?? (oldXpTotal + amt));
      newLevel = hasLevel ? Number(rows?.[0]?.level ?? oldLevel) : oldLevel;

      // Räkna level från XP och uppdatera users.level om kolumn finns och den ändras
      if (hasLevel) {
        const lvl = levelFromXpTotal(newXpTotal);
        if (Number.isFinite(lvl.level) && lvl.level !== newLevel) {
          await dbClient.query(`update users set level = $2 where username = $1`, [u, lvl.level]);
          newLevel = lvl.level;
        }
      }
    } catch (e) {
      console.error("applyXpOnceTx update users failed", e);
    }
  }

  return { inserted, oldXpTotal, newXpTotal, oldLevel, newLevel };
}

async function applyPracticeXpForUserTx(dbClient, match, username, totalScore) {
  const roundsCount = Number(match?.totalRounds ?? (match?.rounds?.length ?? 1));
  const diff = difficultyFactor(match?.difficulty);
  const playedBase = XP_P * diff;
  const perfMult = computePerfMult(totalScore, roundsCount);

  const xpRaw = playedBase * perfMult * XP_PRACTICE_MULT;
  const xpAmount = Math.max(0, Math.round(xpRaw));

  const meta = {
    mode: "practice",
    difficulty: match?.difficulty ?? DEFAULT_DIFFICULTY,
    roundsCount,
    totalScore: Math.round(Number(totalScore || 0)),
    playedBase,
    perfMult,
    practiceMult: XP_PRACTICE_MULT,
  };

  const res = await applyXpOnceTx(dbClient, {
    username,
    matchId: match.id,
    reason: "practice_xp",
    amount: xpAmount,
    meta,
  });

  const newXpTotal = Number(res.newXpTotal ?? res.oldXpTotal ?? 0);
  const oldXpTotal = Number(res.oldXpTotal ?? 0);

  const oldLevel = Number(res.oldLevel ?? 0);
  const newLevel = Number(res.newLevel ?? oldLevel);

  const lvlInfo = levelFromXpTotal(newXpTotal);

  return {
    username,
    xpGained: res.inserted ? xpAmount : 0,
    xpMatch: res.inserted ? xpAmount : 0,
    xpWinBonus: 0,
    xpBadges: 0,
    oldXpTotal,
    newXpTotal,
    oldLevel,
    newLevel,
    ...lvlInfo,
  };
}

// Normal match XP (Steg 3): 1v1 riktiga matcher (ej walkover, ej öva)
async function applyMatchXpForUserTx(dbClient, match, username, totalScore, winner) {
  const roundsCount = Number(match?.totalRounds ?? (match?.rounds?.length ?? 1));
  const diff = difficultyFactor(match?.difficulty);
  const playedBase = XP_P * diff;

  const isWinner = !!winner && String(username) === String(winner);
  const winBase = isWinner ? 4 * playedBase : 0;

  const isQueue = String(match?.source || "").toLowerCase() === "queue";
  const queueMult = isQueue ? 1.25 : 1.0;

  const perfMult = computePerfMult(totalScore, roundsCount);

  // --- Split för UI: Match-del + Vinst-bonus ---
  // Vi vill kunna visa "Match" och "Vinst" separat i klienten, men ändå
  // garantera att summan blir exakt samma som tidigare (inkl. avrundning).
  const baseRaw = playedBase * queueMult * perfMult;
  const winRaw = winBase * queueMult * perfMult;
  const xpAmount = Math.max(0, Math.round(baseRaw + winRaw));

  const xpMatch = Math.max(0, Math.round(baseRaw));
  // Lägg all avrundnings-diff på winBonus så att xpMatch + xpWinBonus == xpAmount
  const xpWinBonus = Math.max(0, xpAmount - xpMatch);

  const meta = {
    mode: "match",
    difficulty: match?.difficulty ?? DEFAULT_DIFFICULTY,
    roundsCount,
    totalScore: Math.round(Number(totalScore || 0)),
    playedBase,
    winBase,
    queueMult,
    isQueue,
    perfMult,
  };

  const res = await applyXpOnceTx(dbClient, {
    username,
    matchId: match.id,
    reason: "match_xp",
    amount: xpAmount,
    meta,
  });

  const newXpTotal = Number(res.newXpTotal ?? res.oldXpTotal ?? 0);
  const oldXpTotal = Number(res.oldXpTotal ?? 0);
  const oldLevel = Number(res.oldLevel ?? 0);
  const newLevel = Number(res.newLevel ?? oldLevel);

  const lvlInfo = levelFromXpTotal(newXpTotal);

  return {
    username,
    xpGained: res.inserted ? xpAmount : 0,
    xpMatch: res.inserted ? xpMatch : 0,
    xpWinBonus: res.inserted ? xpWinBonus : 0,
    xpBadges: 0,
    oldXpTotal,
    newXpTotal,
    oldLevel,
    newLevel,
    ...lvlInfo,
  };
}

// Walkover XP (Steg 5): vinnaren får 50% av playedBase, quitter får 0 (ingen perf, ingen queue, inga badges)
async function getXpSnapshotForUserTx(dbClient, username) {
  const u = String(username || "").trim();
  if (!u) {
    return {
      username: u,
      xpGained: 0,
      xpMatch: 0,
    xpWinBonus: 0,
      xpBadges: 0,
      oldXpTotal: 0,
      newXpTotal: 0,
      oldLevel: 0,
      newLevel: 0,
      ...levelFromXpTotal(0),
    };
  }

  const hasXpTotal = await hasColCached(dbClient, "users", "xp_total");
  const hasLevel = await hasColCached(dbClient, "users", "level");

  if (!hasXpTotal) {
    return {
      username: u,
      xpGained: 0,
      xpMatch: 0,
    xpWinBonus: 0,
      xpBadges: 0,
      oldXpTotal: null,
      newXpTotal: null,
      oldLevel: null,
      newLevel: null,
      ...levelFromXpTotal(0),
    };
  }

  const selCols = ["coalesce(xp_total,0)::bigint as xp_total"];
  if (hasLevel) selCols.push("coalesce(level,0)::int as level");

  const { rows } = await dbClient.query(`select ${selCols.join(", ")} from users where username=$1`, [u]);
  const xpTotal = Number(rows?.[0]?.xp_total ?? 0);
  const level = hasLevel ? Number(rows?.[0]?.level ?? 0) : 0;

  const lvlInfo = levelFromXpTotal(xpTotal);

  return {
    username: u,
    xpGained: 0,
    xpMatch: 0,
    xpWinBonus: 0,
    xpBadges: 0,
    oldXpTotal: xpTotal,
    newXpTotal: xpTotal,
    oldLevel: level,
    newLevel: level,
    ...lvlInfo,
  };
}

async function applyWalkoverWinXpForUserTx(dbClient, match, username) {
  const diff = difficultyFactor(match?.difficulty);
  const playedBase = XP_P * diff;

  const xpRaw = 0.5 * playedBase;
  const xpAmount = Math.max(0, Math.round(xpRaw));

  // Om det blir 0 (bör inte hända), returnera snapshot
  if (xpAmount <= 0) return getXpSnapshotForUserTx(dbClient, username);

  const meta = {
    mode: "walkover",
    difficulty: match?.difficulty ?? DEFAULT_DIFFICULTY,
    playedBase,
    mult: 0.5,
  };

  const res = await applyXpOnceTx(dbClient, {
    username,
    matchId: match.id,
    reason: "walkover_win",
    amount: xpAmount,
    meta,
  });

  const newXpTotal = Number(res.newXpTotal ?? res.oldXpTotal ?? 0);
  const oldXpTotal = Number(res.oldXpTotal ?? 0);
  const oldLevel = Number(res.oldLevel ?? 0);
  const newLevel = Number(res.newLevel ?? oldLevel);
  const lvlInfo = levelFromXpTotal(newXpTotal);

  return {
    username,
    xpGained: res.inserted ? xpAmount : 0,
    xpMatch: res.inserted ? xpAmount : 0,
    xpWinBonus: 0,
    xpBadges: 0,
    oldXpTotal,
    newXpTotal,
    oldLevel,
    newLevel,
    ...lvlInfo,
  };
}


// Badge bonus XP (Steg 4): XP från nyupplåsta badges i matchen (idempotent per match)
async function applyBadgeBonusXpForUserTx(dbClient, match, username, badgeBonusXp, newBadgeCodes = []) {
  const bonus = Math.max(0, Math.round(Number(badgeBonusXp || 0)));
  // Ingen bonus att ge
  if (!bonus) {
    // Returnera basinfo så vi kan visa korrekt progress även om ingen XP gavs
    // (hämtas från users om kolumner finns)
    const hasLevel = await hasColumn(dbClient, "users", "level");
    const { rows } = await dbClient.query(
      `select coalesce(xp_total,0)::bigint as xp_total${hasLevel ? ", coalesce(level,0)::int as level" : ""}
       from users where username=$1`,
      [username]
    );
    const xpTotal = Number(rows?.[0]?.xp_total ?? 0);
    const lvlInfo = levelFromXpTotal(xpTotal);
    return {
      username,
      xpGained: 0,
      xpMatch: 0,
    xpWinBonus: 0,
      xpBadges: 0,
      oldXpTotal: xpTotal,
      newXpTotal: xpTotal,
      oldLevel: Number(rows?.[0]?.level ?? 0),
      newLevel: Number(rows?.[0]?.level ?? 0),
      ...lvlInfo,
    };
  }

  const meta = {
    mode: "badge_bonus",
    difficulty: match?.difficulty ?? DEFAULT_DIFFICULTY,
    badgeCodes: Array.isArray(newBadgeCodes) ? newBadgeCodes : [],
    badgeBonusXp: bonus,
  };

  const res = await applyXpOnceTx(dbClient, {
    username,
    matchId: match.id,
    reason: "badge_bonus",
    amount: bonus,
    meta,
  });

  const newXpTotal = Number(res.newXpTotal ?? res.oldXpTotal ?? 0);
  const oldXpTotal = Number(res.oldXpTotal ?? 0);
  const oldLevel = Number(res.oldLevel ?? 0);
  const newLevel = Number(res.newLevel ?? oldLevel);

  const lvlInfo = levelFromXpTotal(newXpTotal);

  return {
    username,
    xpGained: res.inserted ? bonus : 0,
    xpMatch: 0,
    xpWinBonus: 0,
    xpBadges: res.inserted ? bonus : 0,
    oldXpTotal,
    newXpTotal,
    oldLevel,
    newLevel,
    ...lvlInfo,
  };
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
        const hasBestWinStreak = await hasColumn(client, "users", "best_win_streak");
        if (hasWinStreak) {
          if (hasBestWinStreak) {
            await client.query(
              `update users
               set win_streak = coalesce(win_streak,0) + 1,
                   best_win_streak = greatest(coalesce(best_win_streak,0), coalesce(win_streak,0) + 1)
               where username=$1`,
              [walkoverWinner]
            );
          } else {
            await client.query(`update users set win_streak = coalesce(win_streak,0) + 1 where username=$1`, [
              walkoverWinner,
            ]);
          }
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



        // Steg 5: Walkover XP (vinnare 50% playedBase, quitter 0). Inga badges.


        progressionDelta = {};


        try {


          const dWinner = await applyWalkoverWinXpForUserTx(client, match, walkoverWinner);


          const dLoser = await getXpSnapshotForUserTx(client, walkoverLoser);


          progressionDelta[walkoverWinner] = dWinner;


          progressionDelta[walkoverLoser] = dLoser;


        } catch (e) {


          console.error("walkover XP error", e);


        }


        
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
          const hasBestWinStreak = await hasColumn(client, "users", "best_win_streak");
          if (hasWinStreak) {
            if (hasBestWinStreak) {
              await client.query(
                `update users
                 set win_streak = coalesce(win_streak,0) + 1,
                     best_win_streak = greatest(coalesce(best_win_streak,0), coalesce(win_streak,0) + 1)
                 where username=$1`,
                [winner]
              );
            } else {
              await client.query(`update users set win_streak = coalesce(win_streak,0) + 1 where username=$1`, [winner]);
            }
            await client.query(`update users set win_streak = 0 where username=$1`, [loser]);
          }
        }


        // ✅ Oavgjort mellan två riktiga spelare ska bryta win streak (ingen vann)
        if (!winner && bothReal) {
          const hasWinStreak = await hasColumn(client, "users", "win_streak");
          if (hasWinStreak) {
            await client.query(`update users set win_streak = 0 where username = any($1::text[])`, [realPlayers]);
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

        // Badges delas ut som vanligt (men level skrivs inte längre här)
        const badgeDelta = await awardBadgesAndLevelAfterMatchTx(client, match, winner, total);

        // Steg 3+4: ge idempotent match-XP + badge-bonus-XP för riktiga 1v1-matcher (båda spelare riktiga, ej walkover).
if (bothReal) {
  const xpMatchDelta = {};
  for (const u of realPlayers) {
    const myTotal = Number(total?.[u] ?? 0);
    xpMatchDelta[u] = await applyMatchXpForUserTx(client, match, u, myTotal, winner);
  }

  const xpBadgeDelta = {};
  for (const u of realPlayers) {
    const bonus = Number(badgeDelta?.[u]?.badgeBonusXp ?? 0);
    const codes = badgeDelta?.[u]?.newBadgeCodes ?? [];
    if (bonus > 0) {
      xpBadgeDelta[u] = await applyBadgeBonusXpForUserTx(client, match, u, bonus, codes);
    }
  }

  // Merge: badgeDelta (newBadges etc) + XP-delta. XP-data ska reflektera slutläget efter både match_xp och ev badge_bonus.
  progressionDelta = {};
  for (const u of realPlayers) {
    const b = badgeDelta?.[u] || {};
    const m = xpMatchDelta?.[u] || {};
    const bx = xpBadgeDelta?.[u] || null;

    if (bx) {
      progressionDelta[u] = {
        ...b,
        ...m,
        // Slutläge från badge-bonus (om den sattes denna gång)
        ...bx,
        // Aggregerad XP
        xpMatch: Number(m.xpMatch ?? 0),
        xpWinBonus: Number(m.xpWinBonus ?? 0),
        xpBadges: Number(bx.xpBadges ?? 0),
        xpGained: Number(m.xpGained ?? 0) + Number(bx.xpGained ?? 0),
        // oldXp/oldLevel ska komma från match-deltat (första steget i kedjan)
        oldXpTotal: Number(m.oldXpTotal ?? bx.oldXpTotal ?? 0),
        oldLevel: Number(m.oldLevel ?? bx.oldLevel ?? 0),
      };
    } else {
      progressionDelta[u] = {
        ...b,
        ...m,
      };
    }
  }
} else {
  // Bot/ensam-spelare i icke-öva: behåll endast badgeDelta (vanligen tomt)
  progressionDelta = badgeDelta || {};
}

        // =====================
        // ELO: uppdatera endast för riktiga 1v1-matcher (ej Öva, ej bot, ej walkover)
        // =====================
        try {
          const rated1v1 = bothReal && !match.isSolo && !match.isPractice && !isWalkover;
          if (rated1v1) {
            const hasEloRating = await hasColumn(client, "users", "elo_rating");
            if (hasEloRating) {
              const hasEloPlayed = await hasColumn(client, "users", "elo_played");
              const hasEloPeak = await hasColumn(client, "users", "elo_peak");
              const hasEloUpdatedAt = await hasColumn(client, "users", "elo_updated_at");

              const { rows: eloRows } = await client.query(
                `select username,
                        coalesce(elo_rating, 1000) as elo_rating,
                        coalesce(elo_played, 0) as elo_played,
                        coalesce(elo_peak, 1000) as elo_peak
                 from users
                 where username = any($1::text[])
                 for update`,
                [realPlayers]
              );

              const byU = new Map(eloRows.map((r) => [r.username, r]));
              const A = pA;
              const B = pB;
              const a = byU.get(A);
              const b = byU.get(B);

              if (a && b) {
                const rA = Number(a.elo_rating ?? 1000);
                const rB = Number(b.elo_rating ?? 1000);

                const expA = eloExpected(rA, rB);
                const expB = 1 - expA;

                const sA = eloOutcome(A, winner);
                const sB = eloOutcome(B, winner);

                const kA = eloKFactor(Number(a.elo_played ?? 0));
                const kB = eloKFactor(Number(b.elo_played ?? 0));

                const newA = Math.round(rA + kA * (sA - expA));
                const newB = Math.round(rB + kB * (sB - expB));

                const dA = newA - rA;
                const dB = newB - rB;

                // Uppdatera båda användare
                const setParts = [];
                const params = [];
                // bygg per user-update för att kunna använda olika rating
                async function updateUserElo(u, newR) {
                  const parts = ["elo_rating = $2"]; 
                  const p = [u, newR];
                  let idx = 3;
                  if (hasEloPlayed) {
                    parts.push(`elo_played = coalesce(elo_played,0) + 1`);
                  }
                  if (hasEloPeak) {
                    parts.push(`elo_peak = greatest(coalesce(elo_peak, $2), $2)`);
                  }
                  if (hasEloUpdatedAt) {
                    parts.push(`elo_updated_at = now()`);
                  }
                  await client.query(`update users set ${parts.join(", ")} where username = $1`, p);
                }

                await updateUserElo(A, newA);
                await updateUserElo(B, newB);

                // Skriv Elo-logg (om tabellen finns)
                const canLog = await hasTable(client, "elo_log");
                if (canLog) {
                  await client.query(
                    `insert into public.elo_log
                      (match_id, p1, p2, p1_before, p1_after, p1_delta, p2_before, p2_after, p2_delta, expected_p1, k_used, outcome)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                    [
                      String(match.id),
                      A,
                      B,
                      rA,
                      newA,
                      dA,
                      rB,
                      newB,
                      dB,
                      expA,
                      Math.max(kA, kB),
                      sA,
                    ]
                  );
                }

                // Lägg in i progressionDelta så klienten kan visa efter match
                progressionDelta[A] = {
                  ...(progressionDelta[A] || {}),
                  eloBefore: rA,
                  eloAfter: newA,
                  eloDelta: dA,
                };
                progressionDelta[B] = {
                  ...(progressionDelta[B] || {}),
                  eloBefore: rB,
                  eloAfter: newB,
                  eloDelta: dB,
                };
              }
            }
          }
        } catch (e) {
          console.error("ELO update error", e);
        }
      }

      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      console.error("finishMatch tx error", e);
    } finally {
      client.release();
    }
  }
  else if (match.isPractice && realPlayers.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("begin");

      // Öva/solo: ge endast "spelad + performance" (7%), inga badges, ingen vinst/queue.
      const deltas = {};

      // IMPORTANT: Guest sessions ("Prova") should never persist progression.
      // We still let the match run and finish normally, but skip XP writes.
      const realNonGuest = realPlayers.filter((u) => !isGuestUsername(u));

      for (const u of realPlayers) {
        if (!realNonGuest.includes(u)) {
          // Keep a stable payload shape for the UI, but with 0 gained XP.
          deltas[u] = {
            username: u,
            xpGained: 0,
            xpMatch: 0,
            xpWinBonus: 0,
            xpBadges: 0,
            oldXpTotal: 0,
            newXpTotal: 0,
            oldLevel: 0,
            newLevel: 0,
            level: 0,
            xpLevelBase: 0,
            xpNextLevelAt: 0,
            xpIntoLevel: 0,
            xpToNext: 0,
            xpPctToNext: 0,
          };
          continue;
        }

        const myTotal = Number(total?.[u] ?? 0);
        deltas[u] = await applyPracticeXpForUserTx(client, match, u, myTotal);
      }
      progressionDelta = deltas;

      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      console.error("finishMatch practice tx error", e);
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

function cancelPendingChallengesForUser(username, reason = "offline") {
  const u = String(username || "").trim();
  if (!u) return;

  // Cancel *all* pending challenges involving this user.
  // This prevents the other party from being "stuck" waiting on an accept/decline
  // that will never arrive.
  for (const [id, entry] of pendingChallengesById.entries()) {
    if (!entry) continue;
    if (entry.from !== u && entry.to !== u) continue;

    const other = entry.from === u ? entry.to : entry.from;
    const otherSocketId = other ? getAnySocketId(other) : null;

    // Reuse existing event where possible.
    // - If the challenged user goes offline, the challenger gets "challenge_declined".
    // - If the challenger goes offline, the challenged user gets "challenge_cancelled".
    if (otherSocketId) {
      if (entry.to === u) {
        io.to(otherSocketId).emit("challenge_declined", {
          to: u,
          challengeId: entry.id,
          reason,
        });
      } else {
        io.to(otherSocketId).emit("challenge_cancelled", {
          from: u,
          challengeId: entry.id,
          reason,
        });
      }
    }

    clearChallengeById(id);
  }
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
      // Ensure no one gets stuck in "active match" due to sweep deletion
      try {
        clearActiveMatchForPlayers(match);
      } catch (_) {}
      for (const p of match.players || []) {
        if (p && p !== BOT_NAME) clearDisconnectGrace(p);
      }
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
      const oldIds = socketsByUser.get(username);
      if (oldIds && oldIds.size) {
        for (const oldSocketId of Array.from(oldIds)) {
          if (oldSocketId === socket.id) continue;
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            oldSocket.emit("forced_logout", "Du blev utloggad eftersom du loggade in i en annan flik.");
            oldSocket.disconnect(true);
          }
          // Defensive: ensure stale mappings don't survive if disconnect doesn't fire for some reason.
          removeSocket(oldSocketId);
        }
      }

      currentUser = username;
      addSocketForUser(username, socket.id);
      trackSessionSocket(sessionId, socket.id);

      // Daily stats (admin panel)
      tickDailyStats();
      _dailyStats.loggedInUsers.add(username);

      clearDisconnectGrace(username);

      // Defensive: if there is a stale active match where the opponent vanished
      // (most commonly when the opponent pressed Logout mid-match), immediately
      // resolve it so the connected player never gets stuck as "already in match".
      try {
        const mid = getActiveMatchIdSafe(username);
        if (mid) {
          const m = matches.get(mid);
          if (m && !m.finished) {
            const hasBot = (m.players || []).includes(BOT_NAME);
            const [pA, pB] = m.players || [];
            const other = username === pA ? pB : pA;
            const otherSocketId = other && other !== BOT_NAME ? getAnySocketId(other) : null;

            if (hasBot || m.isPractice || m.isSolo) {
              finishMatch(m, { reason: "cleanup" }).catch((e) => console.error("finish stale practice on auth", e));
            } else if (other && other !== BOT_NAME && !otherSocketId) {
              finishMatchAsWalkover(m, username, other, "cleanup").catch((e) =>
                console.error("walkover stale match on auth", e)
              );
            }
          }
        }
      } catch (e) {
        console.error("auth stale-match cleanup error", e);
      }

      lobby.onlineUsers.add(username);
      broadcastLobby();

      // ✅ Lobbychat-historik (max 5 min)
      socket.emit("lobby_chat_history", { messages: getLobbyChatSnapshot() });

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

  // =====================
  // Lobbychat
  // =====================
  socket.on("lobby_chat_send", async (payload) => {
    if (!currentUser) return;

    let text = String(payload?.text ?? "").trim();
    if (!text) return;

    // enkel anti-spam: begränsa längd
    if (text.length > 240) text = text.slice(0, 240);

    const level = await getUserLevelSafe(currentUser);

    const msg = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      user: currentUser,
      level,
      text,
    };

    lobbyChat.push(msg);
    pruneLobbyChat();

    io.emit("lobby_chat_message", msg);
  });

  socket.on("start_random_match", (payload) => {
    if (!currentUser) return;

    const difficulty =
      payload && typeof payload === "object" ? normalizeDifficulty(payload.difficulty) : DEFAULT_DIFFICULTY;

    if (isUserInActiveMatch(currentUser)) {
      emitAlreadyInMatch(socket, "match_error", currentUser);
      return;
    }

    removeUserFromAllQueues(currentUser);
	// Keep the challenger's client UI in sync: they might have been queued,
	// but challenging pulls them out of the queue.
	socket.emit("queue_state", { queued: false, difficulty: null });

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
      emitAlreadyInMatch(socket, "match_error", currentUser);
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

  // =====================
  // Online list privacy toggle
  // =====================
  socket.on("set_hide_online", (payload) => {
    if (!currentUser) return;
    const hide = !!payload?.hide;
    if (hide) hiddenOnlineUsers.add(currentUser);
    else hiddenOnlineUsers.delete(currentUser);
    broadcastLobby();
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
      emitAlreadyInMatch(socket, "match_error", currentUser);
      return;
    }

    const difficulty =
      payload && typeof payload === "object" ? normalizeDifficulty(payload.difficulty) : normalizeDifficulty("hard");

    removeUserFromAllQueues(currentUser);
    broadcastLobby();

    // Daily stats (admin panel)
    tickDailyStats();
    if (String(currentUser).startsWith("__guest__")) {
      _dailyStats.trialGames += 1;
    } else {
      _dailyStats.soloGames += 1;
    }

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
      emitAlreadyInMatch(socket, "challenge_error", currentUser);
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

    const targetSocketId = getAnySocketId(target);
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

    const fromSocketId = getAnySocketId(entry.from);
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
      emitAlreadyInMatch(socket, "challenge_error", currentUser);
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

    const fromSocketId = getAnySocketId(from);
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
      startInitialRoundCountdown(match);
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


  function handleDeparture(kind) {
    if (!currentUser) return;

    const u = currentUser;

    // Remove presence + cancel pending challenges first.
    removeSocketForUser(u, socket.id);
    cancelPendingChallengesForUser(u, kind);
    broadcastLobby();

    // If the user is in a match, make sure we NEVER leave the opponent stuck.
    const matchId = getActiveMatchIdSafe(u);
    if (!matchId) {
      if (kind === "logout") currentUser = null;
      return;
    }

    const match = matches.get(matchId);
    if (!match || match.finished) {
      if (kind === "logout") currentUser = null;
      return;
    }

    const hasBot = (match.players || []).includes(BOT_NAME);

    // Practice/solo/bot: end immediately so the user never gets stuck.
    if (hasBot || match.isPractice || match.isSolo) {
      finishMatch(match, { reason: kind }).catch((e) => console.error("finish practice on departure", e));
      if (kind === "logout") currentUser = null;
      return;
    }

    const [pA, pB] = match.players;

    // Logout is an explicit leave: forfeit immediately.
    if (kind === "logout") {
      const loser = u;
      const winner = loser === pA ? pB : pA;
      finishMatchAsWalkover(match, winner, loser, "logout").catch((e) => console.error("walkover on logout", e));
      currentUser = null;
      return;
    }

    // Disconnect: allow a short grace window in case the player reconnects.
    if (disconnectGrace.has(u)) return;

    const t = setTimeout(async () => {
      try {
        if (socketsByUser.has(u) && lobby.onlineUsers.has(u)) {
          clearDisconnectGrace(u);
          return;
        }

        const m = matches.get(matchId);
        if (!m || m.finished) {
          clearDisconnectGrace(u);
          return;
        }

        const loser = u;
        const winner = loser === pA ? pB : pA;

        await finishMatchAsWalkover(m, winner, loser, "disconnect");
      } catch (e) {
        console.error("disconnect grace walkover error", e);
      } finally {
        clearDisconnectGrace(u);
      }
    }, DISCONNECT_GRACE_MS);

    disconnectGrace.set(u, { timeoutId: t, untilMs: nowMs() + DISCONNECT_GRACE_MS, matchId });
  }

  socket.on("logout", () => handleDeparture("logout"));

  socket.on("disconnect", () => handleDeparture("disconnect"));
});

// =====================
// Starta servern
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server lyssnar på port", PORT));
