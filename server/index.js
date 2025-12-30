// server/index.js
import { pool } from "./db.js";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
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

// Match/round timing
const ROUND_TIMEOUT_MS = 20_000; // efter 20s: auto-result + vidare
const PENALTY_TIME_MS = 20_000; // om man inte klickar: timeMs som max

// Score normalization
const SCORER_MAX_TIME_MS = 20_000; // normalisera tid i score över 20s
const SCORER_MAX_DISTANCE_KM = 20_000;

// =====================
// Helpers (auth/sessions)
// =====================
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}
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
// Helpers (schema-capabilities)
// =====================
const _colCache = new Map(); // key: `${table}.${col}` -> boolean
async function hasColumn(db, table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);
  const { rows } = await db.query(
    `select 1
     from information_schema.columns
     where table_schema='public'
       and table_name=$1
       and column_name=$2
     limit 1`,
    [table, column]
  );
  const ok = rows.length > 0;
  _colCache.set(key, ok);
  return ok;
}

// =====================
// Helpers (badges/progression)
// =====================
function normalizeBadgeRow(r) {
  return {
    ...r,

    code: r.code,
    groupKey: r.groupKey ?? r.group_key ?? null,
    groupName: r.groupName ?? r.group_name ?? null,
    sortInGroup: r.sortInGroup ?? r.sort_in_group ?? null,
    iconUrl: r.iconUrl ?? r.icon_url ?? null,
    earnedAt: r.earnedAt ?? r.earned_at ?? null,

    group_key: r.groupKey ?? r.group_key ?? null,
    group_name: r.groupName ?? r.group_name ?? null,
    sort_in_group: r.sortInGroup ?? r.sort_in_group ?? null,
    icon_url: r.iconUrl ?? r.icon_url ?? null,
    earned_at: r.earnedAt ?? r.earned_at ?? null,

    badge_code: r.code ?? r.badge_code ?? null,
  };
}

async function getPublicUserRow(username) {
  const { rows } = await pool.query(
    `select
       username,
       played,
       wins,
       losses,
       avg_score as "avgScore",
       pct,
       coalesce(level, 0) as level,
       coalesce(badges_count, 0) as "badgesCount"
     from users
     where username = $1`,
    [username]
  );
  return rows[0] ?? null;
}

async function getUserEarnedBadges(username) {
  const { rows } = await pool.query(
    `select
       ub.badge_code as code,
       ub.earned_at as "earnedAt",
       b.group_key as "groupKey",
       b.group_name as "groupName",
       b.sort_in_group as "sortInGroup",
       b.name,
       b.description,
       b.emoji,
       b.icon_url as "iconUrl"
     from public.user_badges ub
     join public.badges b on b.code = ub.badge_code
     where ub.username = $1
     order by b.group_key asc, b.sort_in_group asc, ub.earned_at asc`,
    [username]
  );
  return rows.map(normalizeBadgeRow);
}

async function buildProgressPayload(username) {
  const user = await getPublicUserRow(username);
  if (!user) return null;
  const earnedBadges = await getUserEarnedBadges(username);

  return {
    username: user.username,
    level: user.level,
    badgesCount: user.badgesCount,
    stats: {
      played: user.played,
      wins: user.wins,
      losses: user.losses,
      avgScore: user.avgScore,
      pct: user.pct,
    },
    earnedBadges,
  };
}

// =====================
// Auth endpoints (DB)
// =====================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Användarnamn och lösenord krävs" });
    }
    const passwordHash = hashPassword(password);
    await pool.query("insert into users (username, password_hash) values ($1, $2)", [
      username,
      passwordHash,
    ]);
    const sessionId = await createSession(username);
    res.json({ sessionId, username });
  } catch (e) {
    if (String(e?.code) === "23505") {
      return res.status(400).json({ error: "Användarnamn är upptaget" });
    }
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Felaktiga inloggningsuppgifter" });
    }
    const { rows } = await pool.query("select password_hash from users where username=$1", [
      username,
    ]);
    const row = rows[0];
    if (!row || row.password_hash !== hashPassword(password)) {
      return res.status(400).json({ error: "Felaktiga inloggningsuppgifter" });
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

// =====================
// User visibility (hidden)
// =====================
app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select username, coalesce(hidden,false) as hidden
       from users
       where username = $1`,
      [req.username]
    );
    const me = rows[0];
    if (!me) return res.status(404).json({ error: "Hittar inte användare" });
    const hidden = !!me.hidden;
    res.json({
      username: me.username,
      hidden,
      showOnLeaderboard: !hidden,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

app.patch("/api/me/leaderboard-visibility", authMiddleware, async (req, res) => {
  try {
    const { showOnLeaderboard } = req.body || {};
    if (typeof showOnLeaderboard !== "boolean") {
      return res.status(400).json({ error: "showOnLeaderboard måste vara boolean" });
    }
    const hidden = !showOnLeaderboard;
    await pool.query(`update users set hidden = $2 where username = $1`, [req.username, hidden]);
    res.json({ ok: true, showOnLeaderboard, hidden });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// BACKWARD COMPAT:
app.post("/api/me/visibility", authMiddleware, async (req, res) => {
  try {
    const { hidden } = req.body || {};
    if (typeof hidden !== "boolean") {
      return res.status(400).json({ error: "hidden måste vara boolean" });
    }
    await pool.query(`update users set hidden = $2 where username = $1`, [req.username, hidden]);
    res.json({ ok: true, hidden, showOnLeaderboard: !hidden });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// =====================
// Badges API
// =====================
app.get("/api/badges", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select
         code,
         group_key as "groupKey",
         group_name as "groupName",
         sort_in_group as "sortInGroup",
         name,
         description,
         emoji,
         icon_url as "iconUrl"
       from public.badges
       order by group_key asc, sort_in_group asc, id asc`
    );
    res.json(rows.map(normalizeBadgeRow));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
});

// ===== Progression endpoints =====
async function handleMeProgress(req, res) {
  try {
    const payload = await buildProgressPayload(req.username);
    if (!payload) return res.status(404).json({ error: "Hittar inte användare" });
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
}
app.get("/api/me/progress", authMiddleware, handleMeProgress);
app.get("/api/me/progression", authMiddleware, handleMeProgress);

async function handleUserProgress(req, res) {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "username saknas" });
    const payload = await buildProgressPayload(username);
    if (!payload) return res.status(404).json({ error: "Hittar inte användare" });
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Serverfel" });
  }
}
app.get("/api/users/:username/progress", handleUserProgress);
app.get("/api/users/:username/progression", handleUserProgress);

// =====================
// Leaderboard (DB)
// =====================
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select
         username,
         played,
         wins,
         losses,
         avg_score as "avgScore",
         pct,
         coalesce(level, 0) as level,
         coalesce(badges_count, 0) as "badgesCount"
       from users
       where coalesce(hidden, false) = false
         and played > 0
       order by
         avg_score asc nulls last,
         pct desc nulls last,
         played desc,
         username asc
       limit $1`,
      [LEADERBOARD_LIMIT]
    );
    res.json(rows);
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
  randomQueue: new Set(),
};

const socketsByUser = new Map(); // username -> socket.id
const matches = new Map(); // matchId -> match

function getRoomName(matchId) {
  return `match_${matchId}`;
}

function createMatch(playerA, playerB, opts = {}) {
  const matchId = crypto.randomBytes(8).toString("hex");
  const scorer = createRoundScorer(SCORER_MAX_DISTANCE_KM, SCORER_MAX_TIME_MS);
  const match = {
    id: matchId,
    players: [playerA, playerB],
    currentRound: 0,
    totalRounds: 10,
    rounds: [],
    finished: false,
    scorer,
    isSolo: !!opts.isSolo,
    isPractice: !!opts.isPractice,
    awaitingStartReady: true,
    startReady: new Set(),
    startReadyTimeout: null,
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

function broadcastLobby() {
  io.emit("lobby_state", { onlineCount: lobby.onlineUsers.size });
}

function tryMatchRandom() {
  if (lobby.randomQueue.size < 2) return;
  const [a, b] = Array.from(lobby.randomQueue).slice(0, 2);
  lobby.randomQueue.delete(a);
  lobby.randomQueue.delete(b);
  const match = createMatch(a, b);
  startMatch(match);
}

function clearStartReady(match) {
  if (match.startReadyTimeout) clearTimeout(match.startReadyTimeout);
  match.startReadyTimeout = null;
  match.awaitingStartReady = false;
  match.startReady = new Set();
}

function beginStartReady(match) {
  match.awaitingStartReady = true;
  match.startReady = new Set();
  const room = getRoomName(match.id);
  io.to(room).emit("start_ready_prompt", { matchId: match.id });

  match.startReadyTimeout = setTimeout(() => {
    if (match.finished) return;
    clearStartReady(match);
    startRound(match);
  }, match.isSolo ? 10_000 : 30_000);
}

function startMatch(match) {
  const roomName = getRoomName(match.id);
  const [pA, pB] = match.players;
  const sA = socketsByUser.get(pA);
  const sB = socketsByUser.get(pB);
  if (!sA || !sB) return;

  io.sockets.sockets.get(sA)?.join(roomName);
  io.sockets.sockets.get(sB)?.join(roomName);

  io.to(roomName).emit("match_started", {
    matchId: match.id,
    players: match.players,
    totalRounds: match.totalRounds,
    isSolo: false,
    isPractice: false,
  });

  beginStartReady(match);
}

function startSoloMatch(match, playerSocket) {
  const roomName = getRoomName(match.id);
  playerSocket.join(roomName);

  io.to(roomName).emit("match_started", {
    matchId: match.id,
    players: match.players,
    totalRounds: match.totalRounds,
    isSolo: true,
    isPractice: !!match.isPractice,
  });

  beginStartReady(match);
}

function pickCityMeta(city) {
  const continent = city?.continent ?? city?.region ?? null;
  return {
    name: city?.name ?? "Okänd stad",
    continent,
    lat: Number(city?.lat),
    lon: Number(city?.lon),
    countryCode: city?.countryCode ?? null,
    population: city?.population ?? null,
    isCapital: city?.isCapital ?? false,
  };
}

function normalizeCityForBadge(city) {
  return pickCityMeta(city);
}

function calculateClick(city, lon, lat, timeMs, scorer) {
  const distanceKm = haversineDistanceKm(lat, lon, city.lat, city.lon);
  const score = scorer(distanceKm, timeMs);
  return { lon, lat, timeMs, distanceKm, score };
}

function calculateTimeoutPenaltyClick(scorer) {
  const distanceKm = SCORER_MAX_DISTANCE_KM;
  const timeMs = PENALTY_TIME_MS;
  const score = scorer(distanceKm, timeMs);
  return { lon: null, lat: null, timeMs, distanceKm, score, timedOut: true };
}

function clearIntermissionTimers(match) {
  if (match.readyPromptTimeout) clearTimeout(match.readyPromptTimeout);
  if (match.readyTimeout) clearTimeout(match.readyTimeout);
  if (match.countdownTimeout) clearTimeout(match.countdownTimeout);
  match.readyPromptTimeout = null;
  match.readyTimeout = null;
  match.countdownTimeout = null;
}

function clearRoundTimeout(match) {
  if (match.roundTimeout) clearTimeout(match.roundTimeout);
  match.roundTimeout = null;
}

function beginIntermission(match) {
  match.awaitingReady = true;
  match.ready = new Set();
  const room = getRoomName(match.id);

  if (match.isSolo) {
    match.readyPromptTimeout = setTimeout(() => {
      if (match.finished) return;
      startNextRoundCountdown(match);
    }, 1200);
    return;
  }

  match.readyPromptTimeout = setTimeout(() => {
    if (match.finished) return;
    io.to(room).emit("ready_prompt", { roundIndex: match.currentRound });
  }, 3500);

  match.readyTimeout = setTimeout(() => {
    if (match.finished) return;
    startNextRoundCountdown(match);
  }, 20_000);
}

function startNextRoundCountdown(match) {
  if (match.finished) return;
  if (!match.awaitingReady) return;

  clearIntermissionTimers(match);
  const room = getRoomName(match.id);

  match.awaitingReady = false;
  const seconds = 5;

  io.to(room).emit("next_round_countdown", { seconds });
  match.countdownTimeout = setTimeout(() => {
    nextRound(match);
  }, seconds * 1000);
}

function emitRoundResultAndIntermission(match, round) {
  if (!round || round.ended) return;
  round.ended = true;
  clearRoundTimeout(match);

  io.to(getRoomName(match.id)).emit("round_result", {
    roundIndex: match.currentRound,
    city: round.city,
    results: round.clicks,
  });

  beginIntermission(match);
}

function startRound(match) {
  clearIntermissionTimers(match);
  clearRoundTimeout(match);

  match.awaitingReady = false;
  match.ready = new Set();

  if (match.currentRound >= match.totalRounds) {
    finishMatch(match).catch((e) => console.error("finishMatch error", e));
    return;
  }

  const city = cities[Math.floor(Math.random() * cities.length)];
  const round = { city, clicks: {}, ended: false };
  match.rounds[match.currentRound] = round;

  const cityMeta = pickCityMeta(city);

  io.to(getRoomName(match.id)).emit("round_starting", {
    roundIndex: match.currentRound,
    cityName: cityMeta.name,
    city: cityMeta,
  });

  match.roundTimeout = setTimeout(() => {
    if (match.finished) return;
    const r = match.rounds[match.currentRound];
    if (!r || r.ended) return;
    if (match.awaitingStartReady) return;

    for (const p of match.players) {
      if (!r.clicks[p]) {
        r.clicks[p] = calculateTimeoutPenaltyClick(match.scorer);
      }
    }
    emitRoundResultAndIntermission(match, r);
  }, ROUND_TIMEOUT_MS);

  if (match.isSolo) {
    setTimeout(() => {
      const r = match.rounds[match.currentRound];
      if (!r || match.finished || r.ended) return;

      const lon = -180 + Math.random() * 360;
      const lat = -60 + Math.random() * 120;
      const timeMs = 600 + Math.random() * 1400;

      if (!r.clicks[BOT_NAME]) {
        r.clicks[BOT_NAME] = calculateClick(r.city, lon, lat, timeMs, match.scorer);
      }

      const [pA, pB] = match.players;
      if (r.clicks[pA] && r.clicks[pB]) {
        emitRoundResultAndIntermission(match, r);
      }
    }, 500);
  }
}

function nextRound(match) {
  match.currentRound += 1;
  startRound(match);
}

function buildMatchAnalytics(match, totalScores) {
  const [pA, pB] = match.players;

  const per = {
    [pA]: { totalScore: totalScores[pA] ?? 0, rounds: [] },
    [pB]: { totalScore: totalScores[pB] ?? 0, rounds: [] },
  };

  for (const r of match.rounds) {
    const city = normalizeCityForBadge(r.city);
    for (const p of match.players) {
      const c = r.clicks[p] || {};
      per[p].rounds.push({
        distanceKm: c.distanceKm ?? null,
        timeMs: c.timeMs ?? null,
        score: c.score ?? null,
        city,
      });
    }
  }

  return per;
}

async function awardBadgesAndLevelAfterMatchTx(dbClient, match, winner, totalScores) {
  const [pA, pB] = match.players;
  const realPlayers = [pA, pB].filter((u) => u !== BOT_NAME);

  const progressionDelta = {}; // username -> { oldLevel, newLevel, oldBadgesCount, newBadgesCount, newBadges: [...] }

  if (match.isPractice) return progressionDelta;
  if (realPlayers.length === 0) return progressionDelta;

  const per = buildMatchAnalytics(match, totalScores);

  const catalog = await getBadgesCatalogWithCriteria(dbClient);
  const byCode = mapBadgesByCode(catalog);

  const hasWinStreak = await hasColumn(dbClient, "users", "win_streak");
  const hasBadgesCount = await hasColumn(dbClient, "users", "badges_count");
  const hasLevel = await hasColumn(dbClient, "users", "level");

  for (const u of realPlayers) {
    const { rows: userRows } = await dbClient.query(
      `select
         username,
         played,
         wins,
         losses,
         coalesce(level, 0) as level,
         coalesce(badges_count, 0) as badges_count
         ${hasWinStreak ? ", coalesce(win_streak, 0) as win_streak" : ""}
       from users
       where username = $1
       for update`,
      [u]
    );
    const user = userRows[0];
    if (!user) continue;

    const isWinner = winner === u;
    const opp = u === pA ? pB : pA;

    const eligibleCodes = evaluateEligibleBadgeCodes({
      catalog,
      userStats: user,
      isWinner,
      totalScore: per[u]?.totalScore,
      rounds: per[u]?.rounds,
      oppTotalScore: per[opp]?.totalScore,
      oppRounds: per[opp]?.rounds,
    });

    // Prefilter: ta bort redan earned innan insert (snabbare + renare)
    let missingCodes = eligibleCodes;
    if (eligibleCodes.length) {
      const { rows: already } = await dbClient.query(
        `select badge_code
         from public.user_badges
         where username = $1
           and badge_code = any($2::text[])`,
        [u, eligibleCodes]
      );
      const alreadySet = new Set(already.map((r) => r.badge_code).filter(Boolean));
      missingCodes = eligibleCodes.filter((c) => !alreadySet.has(c));
    }

    // Insert: endast NEW
    let newlyInsertedCodes = [];
    if (missingCodes.length) {
      const meta = {
        source: "match_finished",
        matchId: match.id,
        winner: isWinner,
      };

      const { rows: ins } = await dbClient.query(
        `insert into public.user_badges (username, badge_code, earned_at, match_id, meta)
         select $1, x, now(), $2, $3::jsonb
         from unnest($4::text[]) as x
         on conflict (username, badge_code) do nothing
         returning badge_code`,
        [u, match.id, JSON.stringify(meta), missingCodes]
      );

      newlyInsertedCodes = ins.map((r) => r.badge_code).filter(Boolean);
    }

    // Räkna badges efter ev insert (gör alltid: håller systemet i synk)
    const { rows: cntRows } = await dbClient.query(
      `select count(*)::int as c from public.user_badges where username = $1`,
      [u]
    );
    const newBadgesCount = cntRows[0]?.c ?? user.badges_count ?? 0;

    // Level = badges_count (enkelt & tydligt i början)
    const newLevel = newBadgesCount;

    // Uppdatera users om kolumnerna finns
    if (hasBadgesCount || hasLevel) {
      const sets = [];
      const params = [u];
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

    progressionDelta[u] = {
      username: u,
      oldLevel: user.level,
      newLevel,
      oldBadgesCount: user.badges_count,
      newBadgesCount,
      newBadges,
    };
  }

  return progressionDelta;
}

async function finishMatch(match) {
  match.finished = true;
  clearIntermissionTimers(match);
  clearStartReady(match);
  clearRoundTimeout(match);

  const [pA, pB] = match.players;
  const total = { [pA]: 0, [pB]: 0 };

  match.rounds.forEach((r) => {
    total[pA] += r.clicks[pA]?.score ?? 0;
    total[pB] += r.clicks[pB]?.score ?? 0;
  });

  let winner = null;
  if (!match.isPractice) {
    if (total[pA] < total[pB]) winner = pA;
    else if (total[pB] < total[pA]) winner = pB;
  }

  const realPlayers = [pA, pB].filter((u) => u !== BOT_NAME);

  let progressionDelta = {};

  if (!match.isPractice && realPlayers.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("begin");

      // 1) played + total_score
      for (const u of realPlayers) {
        await client.query(
          `update users
           set played = played + 1,
               total_score = total_score + $2
           where username = $1`,
          [u, total[u] ?? 0]
        );
      }

      const bothReal = pA !== BOT_NAME && pB !== BOT_NAME;

      // 2) wins/losses + optional win_streak
      if (winner && bothReal) {
        const loser = winner === pA ? pB : pA;

        await client.query(`update users set wins = wins + 1 where username=$1`, [winner]);
        await client.query(`update users set losses = losses + 1 where username=$1`, [loser]);

        const hasWinStreak = await hasColumn(client, "users", "win_streak");
        if (hasWinStreak) {
          await client.query(
            `update users set win_streak = coalesce(win_streak,0) + 1 where username=$1`,
            [winner]
          );
          await client.query(`update users set win_streak = 0 where username=$1`, [loser]);
        }
      }

      // 3) avg_score
      await client.query(
        `update users
         set avg_score = case when played > 0 then total_score / played else 0 end
         where username = any($1::text[])`,
        [realPlayers]
      );

      // 4) pct
      await client.query(
        `update users
         set pct = case
           when (wins + losses) > 0 then round(100.0 * wins / (wins + losses), 1)
           else null
         end
         where username = any($1::text[])`,
        [realPlayers]
      );

      // 5) badges + level + delta
      progressionDelta = await awardBadgesAndLevelAfterMatchTx(client, match, winner, total);

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
  });
}

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
      currentUser = username;
      socketsByUser.set(username, socket.id);
      lobby.onlineUsers.add(username);
      broadcastLobby();
    } catch (e) {
      console.error(e);
      socket.emit("auth_error", "Serverfel vid auth.");
    }
  });

  socket.on("start_random_match", () => {
    if (!currentUser) return;
    lobby.randomQueue.add(currentUser);
    broadcastLobby();
    tryMatchRandom();
  });

  socket.on("start_solo_match", () => {
    if (!currentUser) return;
    const match = createMatch(currentUser, BOT_NAME, { isSolo: true, isPractice: true });
    startSoloMatch(match, socket);
  });

  socket.on("challenge_player", (targetUsername) => {
    if (!currentUser) return;
    const targetSocketId = socketsByUser.get(targetUsername);
    if (!targetSocketId) {
      socket.emit("challenge_error", "Spelaren är inte online");
      return;
    }
    io.to(targetSocketId).emit("challenge_received", { from: currentUser });
  });

  socket.on("accept_challenge", (fromUsername) => {
    if (!currentUser) return;
    const fromSocketId = socketsByUser.get(fromUsername);
    if (!fromSocketId) {
      socket.emit("challenge_error", "Utmanaren är inte längre online");
      return;
    }
    const match = createMatch(fromUsername, currentUser);
    startMatch(match);
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
    if (!match.players.includes(currentUser)) return;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(timeMs)) return;
    if (match.awaitingStartReady) return;

    const round = match.rounds[match.currentRound];
    if (!round || round.ended) return;
    if (match.awaitingReady) return;

    if (!round.clicks[currentUser]) {
      round.clicks[currentUser] = calculateClick(round.city, lon, lat, timeMs, match.scorer);
    }

    const [pA, pB] = match.players;
    if (round.clicks[pA] && round.clicks[pB]) {
      emitRoundResultAndIntermission(match, round);
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
    if (currentUser) {
      lobby.onlineUsers.delete(currentUser);
      lobby.randomQueue.delete(currentUser);
      socketsByUser.delete(currentUser);
      broadcastLobby();
    }
  });
});

// =====================
// Starta servern
// =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server lyssnar på port", PORT));
