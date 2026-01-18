// client/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Login from "./components/Login";
import Lobby from "./components/Lobby";
import Game from "./components/Game";
import UiDialog from "./components/UiDialog";
import UiToast from "./components/UiToast";
import { register, login, logout, guestLogin, API_BASE } from "./api";
import { useI18n } from "./i18n/LanguageProvider.jsx";
import { geoRobinson } from "d3-geo-projection";

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


function tFromError(err, t) {
  const msg = String(err?.message || "");
  const status = err?.status;

  if (msg.startsWith("errors.")) {
    // Don't show blocking popups for request timeouts.
    // (They can happen on slow networks and are not actionable.)
    if (msg === "errors.timeout") return "";
    return t(msg, status ? { status } : undefined);
  }
  return msg || t("errors.unknown");
}


function translateServerMessage(message, t) {
  const msg = String(message || "").trim();
  if (!msg) return t("errors.unknown");

  // Allow server to optionally send i18n keys directly.
  if (msg.startsWith("errors.")) return t(msg);

  // Socket.io server messages (sv) -> i18n
  const map = {
    "Ogiltig session, logga in igen.": "errors.sessionInvalid",
    "Serverfel vid auth.": "errors.authServer",
    "Du blev utloggad eftersom du loggade in i en annan flik.": "errors.forcedLogout",

    "Du är redan i en match.": "errors.alreadyInMatch",

    "Du kan inte utmana dig själv 😅": "errors.challengeSelf",
    "Spelaren är inte online": "errors.playerNotOnline",
    "Spelaren är upptagen i en match": "errors.playerBusy",
    "Utmanaren är inte längre online": "errors.challengerNotOnline",
    "Utmanaren är upptagen i en match": "errors.challengerBusy",
    "Utmaningen är inte riktad till dig.": "errors.challengeNotForYou",
    "Utmaningen är ogiltig eller har gått ut.": "errors.challengeInvalid",
  };

  const key = map[msg];
  return key ? t(key) : msg;
}

export default function App() {
  const { t } = useI18n();

  // =====================
  // Tiny UI sounds (WebAudio)
  // =====================
  const audioCtxRef = useRef(null);

  const ensureAudio = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  };

  // Best-effort unlock as soon as the user interacts anywhere.
  useEffect(() => {
    const onGesture = () => ensureAudio();
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playTone = (freq = 880, duration = 0.12, volume = 0.08, type = "sine") => {
    try {
      const ctx = ensureAudio();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, duration));

      osc.start(now);
      osc.stop(now + Math.max(0.05, duration + 0.02));
    } catch {
      // silent fail
    }
  };

  const playMatchStartSound = () => {
    playTone(660, 0.09, 0.07, "triangle");
    setTimeout(() => playTone(990, 0.11, 0.07, "triangle"), 70);
  };

  const playChallengeSound = () => {
    playTone(523.25, 0.10, 0.07, "sine");
    setTimeout(() => playTone(783.99, 0.12, 0.07, "sine"), 90);
  };

  const initialGameStateRef = useRef({
    city: null,
    currentRound: -1,
    roundResults: [],
    finalResult: null,
  });

  const [session, setSession] = useState(null);
  const [view, setView] = useState("login"); // "login" | "lobby" | "game"
  const [socket, setSocket] = useState(null);
  const [lobbyState, setLobbyState] = useState({ onlineCount: 0, queueCounts: {} });
  // kept for backward compatibility (Lobby no longer consumes it, but other code may)
  const [leaderboard, setLeaderboard] = useState([]);
  const [match, setMatch] = useState(null);
  const [gameState, setGameState] = useState(initialGameStateRef.current);

  const [authLoading, setAuthLoading] = useState(false);
  const [authHint, setAuthHint] = useState("");

  // Login "Prova" (trial practice) state
  const [tryLoading, setTryLoading] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const pendingSoloStartRef = useRef(null); // { difficulty: "easy" }
  const [showTrialPromo, setShowTrialPromo] = useState(false);

  // =====================
  // App dialogs/toasts (replaces window.alert/confirm)
  // =====================
  const [uiDialog, setUiDialog] = useState(null); // { variant, title, message, resolve }
  const [uiToastMsg, setUiToastMsg] = useState("");

  const showToast = (msg) => {
    const m = String(msg || "").trim();
    if (!m) return;
    setUiToastMsg(m);
  };

  const showAlert = (msg, title = "") => {
    const m = String(msg || "").trim();
    if (!m) return Promise.resolve();
    return new Promise((resolve) => {
      setUiDialog({ variant: "alert", title, message: m, resolve });
    });
  };

  const showConfirm = (msg, title = "") => {
    const m = String(msg || "").trim();
    if (!m) return Promise.resolve(false);
    return new Promise((resolve) => {
      setUiDialog({ variant: "confirm", title, message: m, resolve });
    });
  };

  const closeDialog = (result) => {
    setUiDialog((prev) => {
      try {
        prev?.resolve?.(result);
      } catch (_) {}
      return null;
    });
  };

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
const DIFFS = useMemo(
    () => [
      { key: "easy", label: t("common.difficulty.easy") },
      { key: "medium", label: t("common.difficulty.medium") },
      { key: "hard", label: t("common.difficulty.hard") },
    ],
    [t]
  );

  const diffLabel = (key) => DIFFS.find((d) => d.key === key)?.label || key;

  const resetToLobbyState = () => {
    setMatch(null);
    setGameState(initialGameStateRef.current);
    setView("lobby");
  };

  const hardLogout = (message, sock = socket) => {
    if (message) showAlert(message);
    try {
      sock?.disconnect();
    } catch (_) {}
    setSocket(null);
    setSession(null);
    setMatch(null);
    setGameState(initialGameStateRef.current);
    setView("login");
  };

  // --- Socket wiring (connect after login) ---
  useEffect(() => {
    if (!session?.sessionId) return;

    let alive = true;
    let s = null;

    (async () => {
      try {
        const mod = await import("socket.io-client");
        if (!alive) return;

        const io = mod.io;
        // Server expects an explicit "auth" event after connect (not handshake auth)
        s = io(API_BASE, {
          transports: ["websocket"],
          path: "/socket.io",
        });

        setSocket(s);

        s.on("connect", () => {
          try {
            s.emit("auth", session.sessionId);
          } catch (_) {}

          // If Login->Prova triggered a pending solo start, run it right after auth.
          // The server will ignore it if auth hasn't completed yet.
          try {
            const pending = pendingSoloStartRef.current;
            if (pending && pending.difficulty) {
              setTimeout(() => {
                try {
                  s.emit("start_solo_match", { difficulty: pending.difficulty });
                } catch (_) {}
              }, 120);
              pendingSoloStartRef.current = null;
            }
          } catch (_) {}
        });

        s.on("connect_error", (err) => {
          const msg = tFromError(err, t);
          if (msg) showAlert(msg);
        });

        s.on("lobby_state", (state) => {
          setLobbyState(state || { onlineCount: 0, queueCounts: {} });
        });

        s.on("match_started", (data) => {
          // server: { matchId, players, totalRounds, isSolo, isPractice, difficulty }
          // 🔔 small sound when the match transitions from lobby -> game
          try {
            playMatchStartSound();
          } catch (_) {}
          setMatch(data || null);
          setGameState(initialGameStateRef.current);
          setView("game");
        });

        s.on("round_start", ({ roundIndex, cityMeta }) => {
          setGameState((prev) => ({
            ...prev,
            currentRound: typeof roundIndex === "number" ? roundIndex : prev.currentRound,
            city: cityMeta || null,
          }));
        });

        s.on("round_result", ({ results }) => {
          setGameState((prev) => {
            const roundIndex = prev.currentRound;
            const city = prev.city;
            return {
              ...prev,
              roundResults: [...(prev.roundResults || []), { roundIndex, city, results }],
            };
          });
        });

        s.on("match_finished", ({ totalScores, winner, progressionDelta, finishReason }) => {
          setGameState((prev) => ({
            ...prev,
            finalResult: {
              totalScores,
              winner,
              finishReason: finishReason || "normal",
              progressionDelta: progressionDelta || {},
            },
          }));
        });

        s.on("auth_error", (message) => {
          hardLogout(translateServerMessage(message, t), s);
        });

        s.on("forced_logout", (message) => {
          hardLogout(translateServerMessage(message, t), s);
        });

        const showError = (payload) => {
          const isObj = payload && typeof payload === "object";
          const message = isObj ? String(payload.message || "") : String(payload || "");
          const retryAfterMs = isObj ? Number(payload.retryAfterMs) : NaN;

          let text = translateServerMessage(message, t);
          if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
            const seconds = Math.ceil(retryAfterMs / 1000);
            text += `\n${t("game.waiting")} (${seconds}s)`;
          }
          if (text) showAlert(text);
        };

        s.on("match_error", showError);
        s.on("challenge_error", showError);

        s.on("challenge_received", (payload) => {
          // 🔔 small sound when someone challenges you
          try {
            playChallengeSound();
          } catch (_) {}
          const from = payload?.from;
          const challengeId = payload?.challengeId;
          const difficulty = payload?.difficulty;
          if (!from) return;

          // 🔔 sound on incoming challenge
          try {
            playChallengeSound();
          } catch (_) {}

          let text = t("dialogs.acceptChallenge", { from });
          if (difficulty) text += ` (${diffLabel(difficulty)})`;

          (async () => {
            const ok = await showConfirm(text);
            if (ok) {
              if (challengeId) s.emit("accept_challenge", { challengeId });
              else s.emit("accept_challenge", from);
            } else {
              if (challengeId) s.emit("decline_challenge", { challengeId });
              else s.emit("decline_challenge", { fromUsername: from });
            }
          })();
        });
      } catch (e) {
        const msg = tFromError(e, t);
        if (msg) showAlert(msg);
      }
    })();

    return () => {
      alive = false;
      try {
        s?.disconnect();
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId, t]);

  const handleAuth = async ({ username, password, mode }) => {
    setAuthLoading(true);
    setAuthHint(t("common.loading"));

    try {
      const fn = mode === "register" ? register : login;
      const res = await fn(username, password);

      setSession(res);
      setView("lobby");
      setAuthHint("");
    } catch (e) {
      const msg = tFromError(e, t);
      if (msg) showAlert(msg);
      setAuthHint("");
    } finally {
      setAuthLoading(false);
    }
  };

  // --- Login "Prova": start a guest solo practice match (Easy) ---
  const handleTry = async () => {
    if (tryLoading || authLoading) return;

    setTryLoading(true);
    setAuthHint(t("login.startingTry"));
    setShowTrialPromo(false);

    try {
      const res = await guestLogin();
      // Mark this session as a trial session so we can route back to Login after the match.
      setIsTrial(true);
      pendingSoloStartRef.current = { difficulty: "easy" };

      setSession(res);
      // Keep the Login UI visible until the match actually starts.
      setView("login");
    } catch (e) {
      const msg = tFromError(e, t);
      if (msg) showAlert(msg);
    } finally {
      setTryLoading(false);
    }
  };

  const handleLogout = async () => {
    const ok = await showConfirm(t("dialogs.logoutConfirm"));
    if (!ok) return;

    try {
      if (session?.sessionId) await logout(session.sessionId);
    } catch (e) {
      // ignore network failures here (still log out locally)
    } finally {
      setSession(null);
      setSocket(null);
      setMatch(null);
      setGameState(initialGameStateRef.current);
      setView("login");
      try {
        socket?.disconnect();
      } catch (_) {}
    }
  };

  const endTrialAndReturnToLogin = async (showPromoAfter = false) => {
    try {
      if (session?.sessionId) {
        await logout(session.sessionId);
      }
    } catch (_) {
      // ignore
    }

    try {
      socket?.disconnect();
    } catch (_) {}

    setSocket(null);
    setSession(null);
    setMatch(null);
    setGameState(initialGameStateRef.current);
    setIsTrial(false);
    pendingSoloStartRef.current = null;
    setView("login");
    setAuthHint("");
    // Show the promo overlay only after a completed guest match.
    setShowTrialPromo(!!showPromoAfter);
  };

  const handleLeaveMatch = () => {
    if (!match) return;

    // Trial practice from Login -> return to Login (and drop guest session)
    if (isTrial) {
      endTrialAndReturnToLogin(!!gameState?.finalResult);
      return;
    }

    // If match is already finished locally, just go back.
    if (gameState?.finalResult) {
      resetToLobbyState();
      return;
    }

    // Practice/solo: leave immediately (no confirm)
    if (match?.isPractice || match?.isSolo) {
      try {
        socket?.emit("leave_match", { matchId: match.matchId });
      } catch (_) {}
      resetToLobbyState();
      return;
    }

    (async () => {
      const ok = await showConfirm(t("dialogs.leaveMatch"));
      if (!ok) return;

      try {
        socket?.emit("leave_match", { matchId: match.matchId });
      } catch (_) {}

      resetToLobbyState();
    })();
  };

  return (
    <>
      <UiToast
        open={!!uiToastMsg}
        message={uiToastMsg}
        onClose={() => setUiToastMsg("")}
      />

      <UiDialog
        open={!!uiDialog}
        title={uiDialog?.title}
        message={uiDialog?.message}
        variant={uiDialog?.variant}
        okText={t("common.ok")}
        cancelText={t("common.cancel")}
        onOk={() => closeDialog(true)}
        onCancel={() => closeDialog(false)}
      />

      <div className="mobile-block" role="status" aria-live="polite">
        {t("mobile.blocked")}
      </div>

      <div className="app-desktop">
        {view === "login" && (
          <Login
            onSubmit={handleAuth}
            onTry={handleTry}
            promoOpen={showTrialPromo}
            onClosePromo={() => setShowTrialPromo(false)}
            authLoading={authLoading || tryLoading}
            authHint={authHint}
          />
        )}

        {view === "lobby" && session && socket && (
          <Lobby
            session={session}
            socket={socket}
            lobbyState={lobbyState}
            leaderboard={leaderboard}
            onLogout={handleLogout}
            diffLabel={diffLabel}
            diffs={DIFFS}
          />
        )}

        {view === "game" && session && socket && match && (
          <Game
            session={session}
            socket={socket}
            match={match}
            gameState={gameState}
            onLeaveMatch={handleLeaveMatch}
            onLogout={handleLogout}
            showAlert={showAlert}
            onReturnToLogin={isTrial ? () => endTrialAndReturnToLogin(true) : null}
            showReturnToLogin={isTrial}
            mapProject={mapProject}
            mapInvert={mapInvert}
            onMapSize={setMapSize}
          />
        )}
      </div>
    </>
  );
}
