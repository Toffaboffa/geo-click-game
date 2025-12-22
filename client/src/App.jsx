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
 * Byt pixelvärdena till dina egna när du har dem 100% exakt.
 * (Du kan börja med 2-3 st, men fler = stabilare.)
 */
const MAP_REFS = [
  // Exempel (ersätt x/y med dina faktiska pixelpositioner i bilden):
  // { name: "Stockholm", lon: 18.0686, lat: 59.3293, x: 817.5, y: 108.5 },
];

/** Linjär regression: y ≈ a*x + b */
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
 * Bygger en funktion som gör:
 *  - (xImg,yImg) pixlar på din bild -> [lon,lat]
 * via Robinson + kalibrering (skala+offset i x/y) baserat på MAP_REFS.
 */
function makeCalibratedInvert({ width, height, refs }) {
  if (!width || !height) return null;
  if (!refs || refs.length < 2) return null;

  // Bas-projektionen (globen)
  const proj = geoRobinson().fitSize([width, height], { type: "Sphere" });

  // Projektionens pixelkoordinater för referensstäderna
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

  // Kalibrera så att proj-pixlar -> bild-pixlar
  const { a: ax, b: bx } = fitLinear(projXs, imgXs);
  const { a: ay, b: by } = fitLinear(projYs, imgYs);

  // Invert: bild-pixel -> proj-pixel -> lon/lat
  function invertFromImage(xImg, yImg) {
    const xProj = (xImg - bx) / ax;
    const yProj = (yImg - by) / ay;
    const ll = proj.invert([xProj, yProj]); // [lon, lat]
    return ll; // kan vara null om utanför
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

  // NYTT: storlek på kartan (måste matcha bilden på skärmen)
  // Vi låter Game rapportera in aktuell rendered size via onMapSize.
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  // NYTT: skapa invert-funktionen när vi har storlek + refs
  const mapInvert = useMemo(() => {
    return makeCalibratedInvert({
      width: mapSize.width,
      height: mapSize.height,
      refs: MAP_REFS,
    });
  }, [mapSize.width, mapSize.height]);

  useEffect(() => {
    if (!session) return;

    const s = io(API_BASE, {
      transports: ["websocket"],
      path: "/socket.io",
    });

    s.on("connect", () => {
      s.emit("auth", session.sessionId);
    });

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
        roundResults: [],
        finalResult: null,
      });
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
      const data =
        mode === "login" ? await login(username, password) : await register(username, password);
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
        roundResults: [],
        finalResult: null,
      });
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
      // NYTT:
      mapInvert={mapInvert} // (x,y px) -> [lon,lat]
      onMapSize={setMapSize} // Game ska kalla med {width,height} för den klickbara bilden
    />
  );
}
