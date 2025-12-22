// client/src/App.jsx
import React, { useState, useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import { geoRobinson } from "d3-geo";

import { login, register, logout, getLeaderboard, API_BASE } from "./api";
import Login from "./components/Login.jsx";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";

/**
 * Referenspunkter: stadens lon/lat + pixel (x,y) i DIN kartbild.
 * OBS: Dessa pixlar gäller om world.png är EXAKT samma crop/ratio som din guidebild.
 */
const MAP_REFS = [
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

/** Linjär regression: y ≈ a*x + b */
function fitLinear(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0, den = 0;
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
 * (xImg,yImg) pixlar på din bild -> [lon,lat]
 * via Robinson + kalibrering (skala+offset i x/y) baserat på MAP_REFS.
 */
function makeCalibratedInvert({ width, height, refs }) {
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

  function invertFromImage(xImg, yImg) {
    const xProj = (xImg - bx) / ax;
    const yProj = (yImg - by) / ay;
    return proj.invert([xProj, yProj]); // [lon, lat] eller null
  }

  return invertFromImage;
}

export default function App() {
  const [session, setSession] = useState(null); // {sessionId, username}
  const [socket, setSocket] = useState(null);
  const [lobbyState, setLobbyState] = useState({ onlineCount: 0 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [match, setMatch] = useState(null);
  const [gameState, setGameState] = useState({
    currentRound: -1,
    cityName: null,
    roundResults: [],
    finalResult: null,
  });

  // Game rapporterar in aktuell rendered size
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  const mapInvert = useMemo(() => {
    return makeCalibratedInvert({
      width: mapSize.width,
      height: mapSize.height,
      refs: MAP_REFS,
    });
  }, [mapSize.width, mapSize.height]);

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
      setGameState({ currentRound: -1, cityName: null, roundResults: [], finalResult: null });
    });

    s.on("round_starting", ({ roundIndex, cityName }) => {
      setGameState((prev) => ({ ...prev, currentRound: roundIndex, cityName }));
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
      const data = mode === "login"
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
      setGameState({ currentRound: -1, cityName: null, roundResults: [], finalResult: null });
      setSession(null);
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
      onMapSize={setMapSize}
    />
  );
}
