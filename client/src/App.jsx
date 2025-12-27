// client/src/App.jsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { io } from "socket.io-client";
import { geoRobinson } from "d3-geo-projection";
import { login, register, logout, getLeaderboard, API_BASE } from "./api";
import Login from "./components/Login.jsx";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";

/**
 * MAP_REFS är pixelpunkter från en "bas-bild" (din guide).
 * Viktigt: vi skalar refs till aktuell renderad kartstorlek innan kalibrering.
 *
 * SÄTT dessa till den faktiska storleken som dina x/y kommer ifrån.
 * (Alltså den bild/canvas där du mätte upp punkterna.)
 */
const MAP_REF_BASE_SIZE = { width: 1600, height: 800 };

const MAP_REFS_BASE = [
  { name: "San Francisco", lon: -122.4194, lat: 37.7749, x: 247.5, y: 212.5 },
  { name: "Miami", lon: -80.1918, lat: 25.7617, x: 404.5, y: 272.5 },
  { name: "New York", lon: -74.006, lat: 40.7128, x: 449.6, y: 197.8 },
  { name: "Rio de Janeiro", lon: -43.1729, lat: -22.9068, x: 561.2, y: 510.6 },
  { name: "Reykjavik", lon: -21.9426, lat: 64.1466, x: 678.6, y: 87.2 },
  { name: "Stockholm", lon: 18.0686, lat: 59.3293, x: 817.5, y: 108.5 },
  { name: "Athens", lon: 23.7275, lat: 37.9838, x: 843.3, y: 211.0 },
  { name: "Doha", lon: 51.531, lat: 25.2854, x: 965.5, y: 273.5 },
  { name: "Cape Town", lon: 18.4241, lat: -33.9249, x: 821.8, y: 565.4 },
  { name: "Bangkok", lon: 100.5018, lat: 13.7563, x: 1179.5, y: 330.5 },
  { name: "Tokyo", lon: 139.6917, lat: 35.6895, x: 1322.5, y: 222.5 },
  { name: "Wellington", lon: 174.7762, lat: -41.2866, x: 1447.5, y: 601.5 },
];

function fitLinear(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const a = den === 0 ? 1 : num / den;
  const b = meanY - a * meanX;
  return { a, b };
}

/**
 * Skapar kalibrerad projection + invert för din exakta world.png:
 * - project(lon,lat) -> {x,y} i render-pixlar (för debug markör)
 * - invert(x,y) -> [lon,lat] (för spelar-klick)
 */
function makeCalibratedProjection({ width, height, refs }) {
  if (!width || !height) return null;
  if (!refs || refs.length < 2) return null;

  const proj = geoRobinson().fitSize([width, height], { type: "Sphere" });

  const projXs = [];
  const projYs = [];
  const imgXs = [];
  const imgYs = [];

  for (const r of refs) {
    const p = proj([r.lon, r.lat]); // [xProj, yProj]
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
    city: null, // <-- får vi nu från servern i round_starting
    roundResults: [],
    finalResult: null,
  });

  const [debugShowTarget, setDebugShowTarget] = useState(false);
  const toggleDebugShowTarget = useCallback(() => {
    setDebugShowTarget((v) => !v);
  }, []);

  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  // Skala MAP_REFS till aktuell mapSize
  const scaledRefs = useMemo(() => {
    const { width, height } = mapSize;
    if (!width || !height) return null;

    const sx = width / MAP_REF_BASE_SIZE.width;
    const sy = height / MAP_REF_BASE_SIZE.height;

    return MAP_REFS_BASE.map((r) => ({
      ...r,
      x: r.x * sx,
      y: r.y * sy,
    }));
  }, [mapSize.width, mapSize.height]);

  const calibrated = useMemo(() => {
    return makeCalibratedProjection({
      width: mapSize.width,
      height: mapSize.height,
      refs: scaledRefs,
    });
  }, [mapSize.width, mapSize.height, scaledRefs]);

  const mapInvert = calibrated?.invert ?? null;
  const mapProject = calibrated?.project ?? null;

  useEffect(() => {
    if (!session) return;

    const s = io(API_BASE, { transports: ["websocket"], path: "/socket.io" });

    s.on("connect", () => s.emit("auth", session.sessionId));

    s.on("auth_error", (msg) => {
      alert(msg);
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

    // ✅ ta emot cityMeta också
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
    try {
      const data =
        mode === "login"
          ? await login(username, password)
          : await register(username, password);
      setSession(data);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleLogout = async () => {
    try {
      if (session) await logout(session.sessionId).catch(() => {});
    } finally {
      if (socket) socket.disconnect();
      setSocket(null);
      setMatch(null);
      setGameState({
        currentRound: -1,
        cityName: null,
        city: null,
        roundResults: [],
        finalResult: null,
      });
      setSession(null);
      setDebugShowTarget(false);
    }
  };

  if (!session) return <Login onSubmit={handleAuth} />;

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
      onLeaveMatch={() => setMatch(null)}
      mapInvert={mapInvert}
      mapProject={mapProject}
      onMapSize={setMapSize}
      debugShowTarget={debugShowTarget}
      onToggleDebugShowTarget={toggleDebugShowTarget}
    />
  );
}
