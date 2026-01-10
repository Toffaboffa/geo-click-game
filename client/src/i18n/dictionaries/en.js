export default {
  common: {
    appName: "GeoSense",
    language: "Language",
    other: "Other",
    loading: "Loading…",
    close: "Close",
    logout: "Log out",
    leave: "Leave",
    ok: "OK",
    cancel: "Cancel",
    auto: "Auto",
    asc: "Ascending",
    desc: "Descending",
    level: "Level",
    badges: "Badges",
    hoverForInfo: "Hover for info",
    difficulty: {
      easy: "Easy",
      medium: "Medium",
      hard: "Hard",
      total: "Total",
    },
    modes: {
      practice: "Practice",
    },
  },

  mobile: {
    blocked: "GeoSense is currently built for desktop.",
  },

  login: {
    headline: "GeoSense",
    blurb:
      "A fast map battle: you get a city, click on the map, and compete to be both closest and fastest.",
    username: "Username",
    password: "Password",
    loginBtn: "Log in",
    registerBtn: "Create account",
    loggingIn: "Logging in…",
    registering: "Creating account…",
    hint: "Tip: pick a unique username.",
    copy: "© {year} GeoSense",
  },

  lobby: {
    aboutTitle: "What is GeoSense?",
    leaderboard: "Leaderboard",
    myProgress: "My progression",
    loggedInAs: "Logged in as: {user}",
    onlineNowCount: "Online now: {n}.",

    queue: {
      ready: "ready",
    },

    matchRandom: {
      title: "Match vs random",
      readyUp: "Ready up",
      leaveQueue: "Leave queue",
    },

    practice: {
      start: "Start practice",
    },

    challenge: {
      placeholder: "Challenge user...",
      btn: "Challenge",
    },

    lb: {
      visible: "Shown on leaderboard",
      hidden: "Hidden on leaderboard",
      loading: "Loading leaderboard…",
      empty: "No matches played yet.",
      player: "Player",
      sortOption: "Sort: {mode}",
      view: {
        all: "ALL",
      },
      groups: {
        easy: "EASY",
        medium: "MEDIUM",
        hard: "HARD",
        total: "TOTAL",
      },
    },

    about: {
      p1: "GeoSense is a fast 1v1 map duel where precision and speed decide.",
      p2:
        "You get a city name. Click as close as you can on the world map. Lower error (km) and faster time is better.",
      howTitle: "How is the score calculated?",
      p3:
        "Each round scores based on both distance error and time. You see your score instantly after clicking (quick feedback), but the server computes the official result.",
      p4: "After several rounds, the total score decides the winner (lowest total wins).",
      modesTitle: "Game modes",
      p5: "1v1: play another human. Practice: solo mode to train without pressure.",
      lensTitle: "The magnifier",
      p6:
        "The lens helps you aim precisely. After you click, it hides until 1 second remains on the countdown to the next city.",
      progressTitle: "Progression",
      p7:
        "Unlock badges by playing and meeting criteria. Some reward precision, others speed or streaks.",
      p8:
        "The leaderboard supports different sorts and difficulties. You can also choose to hide yourself.",
    },

    progress: {
      title: "{user} • {levelLabel} {level}",
      statsPlayed: "Played",
      statsWins: "Wins",
      statsLosses: "Losses",
      statsWinrate: "Win rate",
      statsAvgScore: "Avg score",
      statsBestMatch: "Best match",
      statsBestWin: "Biggest win",
      badgesLine: "{label}: {earned}/{total} • {hover}",
    },
  },

  game: {
    opponent: "Opponent",
    waiting: "Waiting…",
    ready: "Ready",
    mapNotCalibrated: "The map isn’t calibrated yet.",
    debug: "Debug",
    debugOn: "Debug: ON",

    title: "GeoSense",
    loadingMap: "Loading map…",
    waitingForOthers: "Waiting for others…",
    readyForNext: "Ready for next…",
	roundN: "Round {n}",

    currentTotalScore: "Current total score",
    pop: "Pop",
    nextRoundIn: "Next round in",

    practiceFinished: "Practice finished",
    finalResults: "Final results",
    youWon: "You won!",
    youLost: "You lost.",
    tie: "Tie.",

    city: "City",
    total: "Total",
    backToLobby: "Back to lobby",

    table: {
      scoreCol: "{name} score",
      distanceCol: "{name} distance",
      timeCol: "{name} time",
    },

    flag: "Flag",
    youMarkerTitle: "You: lon {lon}, lat {lat}, t {t}s",
  },

  dialogs: {
    leaveMatch: "Leave the match? This counts as a loss.",
    logoutConfirm: "Log out?",
    acceptChallenge: "Accept challenge from {from}?",
  },

    errors: {
    // REST/HTTP errors (mapped from server)
    notLoggedIn: "Not logged in.",
    serverError: "Server error.",
    missingCreds: "Missing username/password.",
    usernameTaken: "Username already exists.",
    invalidCreds: "Wrong username or password.",
    hiddenMissing: "The \"hidden\" column is missing in users.",
    userNotFound: "User not found.",
    missingUsername: "Missing username.",
    invalidSort: "Invalid sort parameters.",
    apiHtml: "Server responded with an HTML page (likely a wrong URL or proxy).",
    network: "Network error. Check your connection.",
    timeout: "Request timed out.",
    requestFailed: "Request failed.",
    leaderboardLoadFailed: "Could not load the leaderboard.",
    progressionLoadFailed: "Could not load progression.",

    // Socket/server messages
    forcedLogout: "You were logged out because you signed in in another tab.",
    sessionInvalid: "Invalid session, please log in again.",
    authServer: "Server error during authentication.",
    alreadyInMatch: "You are already in a match.",

    challengeSelf: "You can’t challenge yourself 😅",
    playerNotOnline: "The player is not online",
    playerBusy: "The player is busy in a match",
    challengerNotOnline: "The challenger is no longer online",
    challengerBusy: "The challenger is busy in a match",
    challengeNotForYou: "That challenge isn’t addressed to you.",
    challengeInvalid: "The challenge is invalid or has expired.",

    // Generic
    unknown: "Something went wrong.",
  },
};
