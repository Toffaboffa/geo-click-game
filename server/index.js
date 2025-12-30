// server/index.js
import { pool } from "./db.js";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "crypto";
import { cities } from "./cities.js";
import { haversineDistanceKm, createRoundScorer } from "./gameLogic.js";

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
// Auth endpoints (DB)
// =====================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Användarnamn och lösenord krävs" });
    }
    const passwordHash = hashPassword(password);

    // hidden får default false i DB (migration)
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
// GET /api/me -> { username, showOnLeaderboard, hidden }
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

// PATCH /api/me/leaderboard-visibility { showOnLeaderboard: boolean }
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
// POST /api/me/visibility { hidden: boolean }
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
// Leaderboard (DB)
// =====================
// Sortering:
// 1) avg_score ASC (lägst PPM bäst)
// 2) pct DESC (högst win% bäst)
// 3) played DESC (tie-break)
// 4) username ASC
// + spelare med played = 0 visas inte
app.get("/api/leaderboard", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select
         username,
         played,
         wins,
         losses,
         avg_score as "avgScore",
         pct
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

    // start-ready gate
    awaitingStartReady: true,
    startReady: new Set(),
    startReadyTimeout: null,

    // intermission/ready state
    awaitingReady: false,
    ready: new Set(),
    readyPromptTimeout: null,
    readyTimeout: null,
    countdownTimeout: null,

    // round timeout
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

  if (!match.isSolo) {
    match.startReadyTimeout = setTimeout(() => {
      if (match.finished) return;
      clearStartReady(match);
      startRound(match);
    }, 30_000);
    return;
  }

  match.startReadyTimeout = setTimeout(() => {
    if (match.finished) return;
    clearStartReady(match);
    startRound(match);
  }, 10_000);
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
  };
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
  if (total[pA] < total[pB]) winner = pA;
  else if (total[pB] < total[pA]) winner = pB;

  const realPlayers = [pA, pB].filter((u) => u !== BOT_NAME);

  if (realPlayers.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("begin");

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
      if (winner && bothReal) {
        const loser = winner === pA ? pB : pA;
        await client.query(`update users set wins = wins + 1 where username=$1`, [winner]);
        await client.query(`update users set losses = losses + 1 where username=$1`, [loser]);
      }

      // avg_score
      await client.query(
        `update users
         set avg_score = case when played > 0 then total_score / played else 0 end
         where username = any($1::text[])`,
        [realPlayers]
      );

      // ✅ pct (win%) i DB: 100 * wins/(wins+losses), 1 decimal. null om 0 matcher.
      await client.query(
        `update users
         set pct = case
           when (wins + losses) > 0 then round(100.0 * wins / (wins + losses), 1)
           else null
         end
         where username = any($1::text[])`,
        [realPlayers]
      );

      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  io.to(getRoomName(match.id)).emit("match_finished", { totalScores: total, winner });
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
    const match = createMatch(currentUser, BOT_NAME, { isSolo: true });
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
