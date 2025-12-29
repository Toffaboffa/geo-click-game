// client/src/App.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import { geoRobinson } from "d3-geo-projection";
import { login, register, logout, getLeaderboard, API_BASE } from "./api";
import Login from "./components/Login.jsx";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";

/**
 * Pixelpunkter uppmätta på din bas-bild (world_debug.png / world.png).
 * Vi skalar refs till aktuell renderad kartstorlek innan kalibrering.
 */
const MAP_REF_BASE_SIZE = { width: 5600, height: 2900 };
const MAP_REFS_BASE = [
  { name: "San Francisco", lon: -122.4194, lat: 37.7749, x: 903, y: 777 },
  { name: "Miami", lon: -80.1918, lat: 25.7617, x: 1477, y: 995 },
  { name: "New York", lon: -74.006, lat: 40.7128, x: 1641, y: 723 },
  { name: "Rio de Janeiro", lon: -43.1729, lat: -22.9068, x: 2048, y: 1865 },
  { name: "Reykjavik", lon: -21.9426, lat: 64.1466, x: 2475, y: 319 },
  { name: "Stockholm", lon: 18.0686, lat: 59.3293, x: 2982, y: 396 },
  { name: "Athens", lon: 23.7275, lat: 37.9838, x: 3077, y: 771 },
  { name: "Doha", lon: 51.531, lat: 25.2854, x: 3522, y: 998 },
  { name: "Cape Town", lon: 18.4241, lat: -33.9249, x: 2998, y: 2065 },
  { name: "Bangkok", lon: 100.5018, lat: 13.7563, x: 4304, y: 1208 },
  { name: "Tokyo", lon: 139.6917, lat: 35.6895, x: 4824, y: 812 },
  { name: "Wellington", lon: 174.7762, lat: -41.2866, x: 5280, y: 2198 },
];
const GRID_REFS_BASE = [
  { name: "G 0,0", lon: 0, lat: 0, x: 2713, y: 1459 },
  { name: "G 0,30", lon: 0, lat: 30, x: 2719, y: 917 },
  { name: "G 0,60", lon: 0, lat: 60, x: 2745, y: 389 },
  { name: "G 0,-30", lon: 0, lat: -30, x: 2719, y: 2001 },
  { name: "G 0,-60", lon: 0, lat: -60, x: 2745, y: 2529 },
  { name: "G 150,0", lon: 150, lat: 0, x: 5102, y: 1459 },
  { name: "G 150,30", lon: 150, lat: 30, x: 5013, y: 917 },
  { name: "G 150,60", lon: 150, lat: 60, x: 4653, y: 389 },
  { name: "G 150,-30", lon: 150, lat: -30, x: 5013, y: 2001 },
  { name: "G 150,-60", lon: 150, lat: -60, x: 4652, y: 2529 },
  { name: "G -150,60", lon: -150, lat: 60, x: 838, y: 389 },
  { name: "G -150,30", lon: -150, lat: 30, x: 427, y: 917 },
  { name: "G -150,0", lon: -150, lat: 0, x: 325, y: 1459 },
  { name: "G -150,-30", lon: -150, lat: -30, x: 427, y: 2001 },
  { name: "G -150,-60", lon: -150, lat: -60, x: 838, y: 2529 },
];
const ALL_REFS_BASE = [...MAP_REFS_BASE, ...GRID_REFS_BASE];

/** Linjär regression: y ≈ a*x + b */
function fitLinear(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const a = den === 0 ? 1 : num / den;
  const b = meanY - a * meanX;
  return { a, b };
}

function makeCalibratedProjection({ width, height, refs }) {
  if (!width || !height) return null;
  if (!refs || refs.length < 2) return null;

  const proj = geoRobinson().fitSize([width, height], { type: "Sphere" });

  const projXs = [];
  const projYs = [];
  const imgXs = [];
  const imgYs = [];

  for (const r of refs) {
    const p = proj([r.lon, r.lat]);
    if (!p || Number.isNaN(p[0]) || Number.isNaN(p[1])) continue;
    projXs.push(p[0]);
    projYs.push(p[1]);
    imgXs.push(r.x);
    imgYs.push(r.y);
  }
  if (projXs.length < 2) return null;

  const { a: ax, b: bx } = fitLinear(projXs, imgXs);
  const { a: ay, b: by } = fitLinear(projYs, imgYs);

  const project = (lon, lat) => {
    const p = proj([lon, lat]);
    if (!p) return null;
    const x = ax * p[0] + bx;
    const y = ay * p[1] + by;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  const invert = (x, y) => {
    const xProj = (x - bx) / ax;
    const yProj = (y - by) / ay;
    return proj.invert([xProj, yProj]);
  };

  return { project, invert };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [socket, setSocket] = useState(null);

  const [lobbyState, setLobbyState] = useState({ onlineCount: 0 });
  const [leaderboard, setLeaderboard] = useState([]);

  const [match, setMatch] = useState(null);
  const [gameState, setGameState] = useState({
    currentRound: -1,
    cityName: null,
    city: null,
    roundResults: [],
    finalResult: null,
  });

  const [debugShowTarget, setDebugShowTarget] = useState(false);
  const toggleDebugShowTarget = useCallback(() => {
    setDebugShowTarget((v) => !v);
  }, []);

  // ✅ NYTT: login/loading-state + “Render vaknar”-hint
  const [authLoading, setAuthLoading] = useState(false);
  const [authHint, setAuthHint] = useState(null);
  const authSlowTimerRef = useRef(null);

  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  const scaledRefs = useMemo(() => {
    const { width, height } = mapSize;
    if (!width || !height) return null;
    const sx = width / MAP_REF_BASE_SIZE.width;
    const sy = height / MAP_REF_BASE_SIZE.height;
    return ALL_REFS_BASE.map((r) => ({
      ...r,
      x: r.x * sx,
      y: r.y * sy,
    }));
  }, [mapSize.width, mapSize.height]);

  const calibrated = useMemo(() => {
    if (!scaledRefs) return null;
    return makeCalibratedProjection({
      width: mapSize.width,
      height: mapSize.height,
      refs: scaledRefs,
    });
  }, [mapSize.width, mapSize.height, scaledRefs]);

  const mapInvert = calibrated?.invert ?? null;
  const mapProject = calibrated?.project ?? null;

  const resetToLobbyState = useCallback(() => {
    setMatch(null);
    setGameState({
      currentRound: -1,
      cityName: null,
      city: null,
      roundResults: [],
      finalResult: null,
    });
    setDebugShowTarget(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    const s = io(API_BASE, { transports: ["websocket"], path: "/socket.io" });

    s.on("connect", () => s.emit("auth", session.sessionId));
    s.on("auth_error", (msg) => {
      alert(msg);
      // logga ut helt om session är kass
      handleLogout();
    });

    s.on("lobby_state", (state) => setLobbyState(state));

    s.on("challenge_received", ({ from }) => {
      const accept = window.confirm(`${from} utmanar dig. Accepterar du?`);
      if (accept) s.emit("accept_challenge", from);
    });

    s.on("match_started", (data) => {
      setMatch(data);
      setGameState({
        currentRound: -1,
        cityName: null,
        city: null,
        roundResults: [],
        finalResult: null,
      });
      setDebugShowTarget(false);
    });

    s.on("round_starting", ({ roundIndex, cityName, city }) => {
      setGameState((prev) => ({
        ...prev,
        currentRound: roundIndex,
        cityName: cityName ?? city?.name ?? null,
        city: city ?? null,
      }));
    });

    s.on("round_result", ({ roundIndex, city, results }) => {
      setGameState((prev) => ({
        ...prev,
        roundResults: [...prev.roundResults, { roundIndex, city, results }],
      }));
    });

    s.on("match_finished", ({ totalScores, winner }) => {
      setGameState((prev) => ({ ...prev, finalResult: { totalScores, winner } }));
      getLeaderboard(session.sessionId).then(setLeaderboard).catch(console.error);
    });

    setSocket(s);
    getLeaderboard(session.sessionId).then(setLeaderboard).catch(console.error);

    return () => s.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleAuth = async (mode, username, password) => {
    if (authLoading) return;

    // reset UI
    setAuthLoading(true);
    setAuthHint(null);

    if (authSlowTimerRef.current) clearTimeout(authSlowTimerRef.current);
    authSlowTimerRef.current = setTimeout(() => {
      // efter ~1.2s: visa hint att servern kan vara “asleep”
      setAuthHint("Startar servern… detta kan ta 30–60 sek första gången.");
    }, 1200);

    try {
      const data =
        mode === "login"
          ? await login(username, password)
          : await register(username, password);

      setSession(data);
    } catch (e) {
      alert(e.message);
    } finally {
      if (authSlowTimerRef.current) clearTimeout(authSlowTimerRef.current);
      authSlowTimerRef.current = null;
      setAuthLoading(false);
      setAuthHint(null);
    }
  };

  const handleLogout = async () => {
    try {
      if (session) await logout(session.sessionId).catch(() => {});
    } finally {
      if (socket) socket.disconnect();
      setSocket(null);
      resetToLobbyState();
      setSession(null);
    }
  };

  const handleLeaveMatch = () => {
    // Vi lämnar bara UI:t till lobby (servern får vi fixa “leave match” i index.js sen)
    resetToLobbyState();
  };

  if (!session) {
    return (
      <Login
        onSubmit={handleAuth}
        authLoading={authLoading}
        authHint={authHint}
      />
    );
  }

  if (!match) {
    return (
      <Lobby
        session={session}
        socket={socket}
        lobbyState={lobbyState}
        leaderboard={leaderboard}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <Game
      session={session}
      socket={socket}
      match={match}
      gameState={gameState}
      onLogout={handleLogout}
      onLeaveMatch={handleLeaveMatch}
      mapInvert={mapInvert}
      mapProject={mapProject}
      onMapSize={setMapSize}
      debugShowTarget={debugShowTarget}
      onToggleDebugShowTarget={toggleDebugShowTarget}
    />
  );
}
