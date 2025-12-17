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

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ===== In-memory "databas" =====

const users = new Map(); // username -> { passwordHash, stats }
const sessions = new Map(); // sessionId -> username
const socketsByUser = new Map(); // username -> socket.id

function initStats() {
  return { played: 0, wins: 0, losses: 0, totalScore: 0, avgScore: 0 };
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function createSession(username) {
  const id = crypto.randomBytes(16).toString("hex");
  sessions.set(id, username);
  return id;
}

function authMiddleware(req, res, next) {
  const sid = req.headers["x-session-id"];
  if (!sid || !sessions.has(sid)) {
    return res.status(401).json({ error: "Inte inloggad" });
  }
  req.username = sessions.get(sid);
  next();
}

// ===== Auth endpoints =====

app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Användarnamn och lösenord krävs" });
  }

  if (users.has(username)) {
    return res.status(400).json({ error: "Användarnamn är upptaget" });
  }

  users.set(username, {
    passwordHash: hashPassword(password),
    stats: initStats()
  });

  const sessionId = createSession(username);
  res.json({ sessionId, username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = users.get(username);
  if (!user) {
    return res.status(400).json({ error: "Felaktiga inloggningsuppgifter" });
  }
  if (user.passwordHash !== hashPassword(password)) {
    return res.status(400).json({ error: "Felaktiga inloggningsuppgifter" });
  }

  const sessionId = createSession(username);
  res.json({ sessionId, username });
});

app.post("/api/logout", authMiddleware, (req, res) => {
  // ta bort just denna session
  const sid = req.headers["x-session-id"];
  sessions.delete(sid);
  res.json({ ok: true });
});

// ===== Leaderboard =====

app.get("/api/leaderboard", (_req, res) => {
  const list = Array.from(users.entries()).map(([username, data]) => {
    const { played, wins, losses, avgScore } = data.stats;
    return { username, played, wins, losses, avgScore };
  });

  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins; // flest vinster
    return a.avgScore - b.avgScore; // lägst snittpoäng
  });

  res.json(list.slice(0, 50));
});

// ===== Lobby & matchning (Socket.io) =====

const lobby = {
  onlineUsers: new Set(), // usernames online
  randomQueue: new Set() // usernames som vill slumpmatchas
};

const matches = new Map(); // matchId -> matchState

function createMatch(playerA, playerB) {
  const id = crypto.randomBytes(8).toString("hex");
  const scorer = createRoundScorer();

  const match = {
    id,
    players: [playerA, playerB],
    currentRound: 0,
    totalRounds: 10,
    rounds: [],
    finished: false,
    scorer
  };
  matches.set(id, match);
  return match;
}

io.on("connection", (socket) => {
  let currentUser = null;

  // klienten skickar sitt session-id när socket kopplas
  socket.on("auth", (sessionId) => {
    const username = sessions.get(sessionId);
    if (!username) {
      socket.emit("auth_error", "Ogiltig session, logga in igen.");
      return;
    }
    currentUser = username;
    socketsByUser.set(username, socket.id);
    lobby.onlineUsers.add(username);
    broadcastLobby();
  });

  socket.on("start_random_match", () => {
    if (!currentUser) return;
    lobby.randomQueue.add(currentUser);
    broadcastLobby();
    tryMatchRandom();
  });

  socket.on("challenge_player", (targetUsername) => {
    if (!currentUser) return;
    const targetSocketId = socketsByUser.get(targetUsername);
    if (!targetSocketId) {
      socket.emit("challenge_error", "Spelaren är inte online");
      return;
    }
    io.to(targetSocketId).emit("challenge_received", {
      from: currentUser
    });
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

  socket.on("player_click", ({ matchId, x, y, timeMs }) => {
    const match = matches.get(matchId);
    if (!match || match.finished) return;
    if (!match.players.includes(currentUser)) return;

    const round = match.rounds[match.currentRound];
    if (!round) return;

    if (!round.clicks[currentUser]) {
      round.clicks[currentUser] = calculateClick(
        round.city,
        x,
        y,
        timeMs,
        match.scorer
      );
    }

    const [pA, pB] = match.players;
    if (round.clicks[pA] && round.clicks[pB]) {
      io.to(getRoomName(match.id)).emit("round_result", {
        roundIndex: match.currentRound,
        city: round.city,
        results: round.clicks
      });
      nextRound(match);
    }
  });

  socket.on("disconnect", () => {
    if (currentUser) {
      lobby.onlineUsers.delete(currentUser);
      lobby.randomQueue.delete(currentUser);
      socketsByUser.delete(currentUser);
      broadcastLobby();
    }
  });

  // ===== Hjälpfunktioner för lobby/matchning =====

  function broadcastLobby() {
    io.emit("lobby_state", {
      onlineCount: lobby.onlineUsers.size
    });
  }

  function tryMatchRandom() {
    if (lobby.randomQueue.size < 2) return;
    const [a, b] = Array.from(lobby.randomQueue).slice(0, 2);
    lobby.randomQueue.delete(a);
    lobby.randomQueue.delete(b);

    const match = createMatch(a, b);
    startMatch(match);
  }

  function getRoomName(matchId) {
    return `match_${matchId}`;
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
      totalRounds: match.totalRounds
    });

    startRound(match);
  }

  function startRound(match) {
    if (match.currentRound >= match.totalRounds) {
      finishMatch(match);
      return;
    }

    const city = cities[Math.floor(Math.random() * cities.length)];
    const round = {
      city,
      clicks: {}
    };
    match.rounds[match.currentRound] = round;

    io.to(getRoomName(match.id)).emit("round_starting", {
      roundIndex: match.currentRound,
      countdownSeconds: 5,
      cityName: city.name
    });
  }

  function nextRound(match) {
    match.currentRound += 1;
    startRound(match);
  }

  function finishMatch(match) {
    match.finished = true;
    const [pA, pB] = match.players;
    const total = { [pA]: 0, [pB]: 0 };

    match.rounds.forEach((r) => {
      total[pA] += r.clicks[pA]?.score ?? 0;
      total[pB] += r.clicks[pB]?.score ?? 0;
    });

    let winner = null;
    if (total[pA] < total[pB]) winner = pA;
    else if (total[pB] < total[pA]) winner = pB;

    [pA, pB].forEach((u) => {
      const user = users.get(u);
      if (!user) return;
      user.stats.played += 1;
      user.stats.totalScore += total[u];
    });

    if (winner) {
      const loser = winner === pA ? pB : pA;
      users.get(winner).stats.wins += 1;
      users.get(loser).stats.losses += 1;
    }

    [pA, pB].forEach((u) => {
      const user = users.get(u);
      if (!user) return;
      user.stats.avgScore =
        user.stats.played > 0
          ? user.stats.totalScore / user.stats.played
          : 0;
    });

    io.to(getRoomName(match.id)).emit("match_finished", {
      totalScores: total,
      winner
    });
  }

  function calculateClick(city, x, y, timeMs, scorer) {
    // x,y ∈ [0,1] från klientens klick på kartan
    const lon = x * 360 - 180;
    const lat = 90 - y * 180;

    const distanceKm = haversineDistanceKm(lat, lon, city.lat, city.lon);
    const score = scorer(distanceKm, timeMs);
    return { timeMs, distanceKm, score };
  }
});

// ===== Starta servern =====

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server lyssnar på port", PORT);
});

