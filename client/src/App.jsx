import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import { login, register, logout, getLeaderboard, API_BASE } from "./api";
import Login from "./components/Login.jsx";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";

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
    finalResult: null
  });

  useEffect(() => {
    if (!session) return;

    const s = io(API_BASE, {
      transports: ["websocket"],
      path: "/socket.io"
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
      if (accept) {
        s.emit("accept_challenge", from);
      }
    });

    s.on("match_started", (data) => {
      setMatch(data);
      setGameState({
        currentRound: -1,
        cityName: null,
        roundResults: [],
        finalResult: null
      });
    });

    s.on("round_starting", ({ roundIndex, cityName }) => {
      setGameState((prev) => ({
        ...prev,
        currentRound: roundIndex,
        cityName
      }));
    });

    s.on("round_result", ({ roundIndex, city, results }) => {
      setGameState((prev) => ({
        ...prev,
        roundResults: [...prev.roundResults, { roundIndex, city, results }]
      }));
    });

    s.on("match_finished", ({ totalScores, winner }) => {
      setGameState((prev) => ({
        ...prev,
        finalResult: { totalScores, winner }
      }));
      getLeaderboard(session.sessionId)
        .then(setLeaderboard)
        .catch(console.error);
    });

    setSocket(s);

    getLeaderboard(session.sessionId)
      .then(setLeaderboard)
      .catch(console.error);

    return () => {
      s.disconnect();
    };
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
      if (session) {
        await logout(session.sessionId).catch(() => {});
      }
    } finally {
      if (socket) socket.disconnect();
      setSocket(null);
      setMatch(null);
      setGameState({
        currentRound: -1,
        cityName: null,
        roundResults: [],
        finalResult: null
      });
      setSession(null);
    }
  };

  if (!session) {
    return <Login onSubmit={handleAuth} />;
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
      onLeaveMatch={() => setMatch(null)}
    />
  );
}
