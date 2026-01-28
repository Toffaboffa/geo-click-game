export default {
  common: {
    appName: "GeoSense",
    language: "Language",
    other: "Other",
    loading: "Loading...",
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
    xp: "XP",
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
    noEmailTitle: "No email needed.",
    noEmailBody: "Choose a username (your in-game nickname) and a password. We only store username + password so we can save your progression.",
    usernamePlaceholder: "e.g. SpaceFox (not an email)",
    usernameHelp: "Don’t enter your email. Your username is visible to other players.",
    emailDetected: "That looks like an email address. Use a nickname instead.",

    username: "Username",
    password: "Password",
    loginBtn: "Log in",
    registerBtn: "Create account",
    tryBtn: "Try",
    startingTry: "Starting practice…",
    loggingIn: "Logging in…",
    registering: "Creating account…",
    promo: {
      aria: "GeoSense – info",
      title: "Like GeoSense?",
      text:
        "Want to compete against others? Save your progression, collect medals, XP and level up. Create an account and challenge friends or random opponents around the world.",
    },
    hint: " ",
    copy: "© {year} GeoSense",
  },

  lobby: {
    aboutTitle: "What is GeoSense?",
    leaderboard: "Leaderboard",
    leaderboardMinMatchesHint: "Play at least 3 matches to appear on the leaderboard.",
    myProgress: "My progression",
    loggedInAs: "Logged in as: {user}",
    onlineNowCount: "Online now: {n}.",
    onlinePlayersTitle: "Online",
    onlineClickToView: "Click to view progression",
    onlineChallenge: "Challenge player",
    onlineHideMe: "Hide me in the list",
    onlineShowMe: "Show me in the list",
    onlineHideMeTitle: "Control whether you appear in the online list",


    bugReport: "Report a bug",
    bugReportTitle: "Report a bug",
    bugReportHint: "Briefly describe what happened. Copy the report (incl. diagnostics) and paste it where you report bugs — or open an email draft.",
    bugReportPlaceholder: "Steps…\n\nExpected: …\nActual: …",
    bugReportCopy: "Copy report",
    bugReportCopied: "Copied!",
    bugReportEmail: "Open email",

    // New feedback flow (stores to Supabase via server)
    feedback: {
      title: "Send feedback",
      adminTitle: "Feedback (admin)",
      kindBug: "Report a bug",
      kindFeature: "Suggestion / feature",
      placeholderBug: "Describe the bug clearly…\n\nSteps: 1) … 2) …\nExpected: …\nActual: …",
      placeholderFeature: "Describe your idea…\n\nWhat should improve? Why? How should it work?",
      send: "Send",
      sending: "Sending…",
      sent: "Sent!",
      errorEmpty: "Write something first.",
      filterAll: "All",
      filterBug: "Bugs",
      filterFeature: "Ideas",
      refresh: "Refresh",
      empty: "No entries yet.",
      colTime: "Time",
      colKind: "Type",
      colUser: "User",
      colMessage: "Message",
      colUrl: "URL",
      colLang: "Lang",
    },
    whatsNew: {
      title: "What’s new",
      adminTitle: "Publish update",
      adminMissing: "Please enter a title and text.",
      adminSent: "Published!",
      adminTitlePlaceholder: "Title (short)",
      adminDate: "Date",
      adminBodyPlaceholder: "Write what’s new… (only the two latest are shown)",
      adminPublish: "Publish",
    },

    quickChallenge: {
      title: "Challenge {user}",
      pickDifficulty: "Choose difficulty:",
      send: "Send challenge",
    },

    chat: {
      title: "Lobby chat",
      toggleShow: "Show chat",
      toggleHide: "Hide chat",
      placeholder: "Write a message…",
      send: "Send",
      ttl: "Disappears after 15 min",
      empty: "No messages yet.",
    },
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
        "Hold CTRL to activate the lens when you want extra precision. After you click, it hides until 1 second remains on the countdown to the next city.",
      progressTitle: "Progression",
      p7:
        "Unlock badges by playing and meeting criteria. Some reward precision, others speed or streaks.",
      p8:
        "The leaderboard supports different sorts and difficulties. You can also choose to hide yourself.",
    },

aboutTabs: {
  basic: "Basic",
  scoring: "Scoring",
  xp: "XP & Badges",
  leaderboard: "Leaderboard",
},

aboutScoring: {
  p1: "Your round score is the sum of a distance part and a time part. Lower is better. The maximum is 2000 points (1000 + 1000).",
  p2: "The distance part is linear up to 17,000 km (roughly the antipode). The time part follows an exponential curve and is normalized so that 20 s gives 1000 points.",
  hFormula: "Formula",
  formula:
    "distPenalty = min(distanceKm / 17000, 1)\n" +
    "tNorm = clamp(timeMs / 20000, 0, 1)\n" +
    "timePenalty = expm1(3.2 * tNorm) / expm1(3.2)\n" +
    "roundScore = 1000 * distPenalty + 1000 * timePenalty",
  hExamples: "Examples",
  ex1: "34 km off and 5.0 s: dist ≈ 34/17000 → 2 pts, time ≈ 52 pts ⇒ total ≈ 54 pts.",
  ex2: "850 km off and 2.0 s: dist ≈ 50 pts, time ≈ 16 pts ⇒ total ≈ 66 pts.",
  ex3: "No click within 20 s: you get the max penalty (≈ 2000 points) for that round.",
},

aboutLeaderboard: {
  p1: "The leaderboard shows stats per difficulty (Easy/Medium/Hard) plus Total. You can switch view and sorting.",
  hColumns: "Abbreviations",
  colLvl: "Your level (increases with XP and never goes down).",
  colSm: "Matches played (total played in the selected difficulty).",
  colVm: "Matches won.",
  colFm: "Matches lost.",
  colPct: "Win rate (VM/SM). Higher is better.",
  colPpm: "Average points per match (lower is better).",
  colScore: "Rank score (higher is better) computed from win rate + avg score, weighted by difficulty, match count, and level.",

  colElo: "ELO rating (a skill rating that changes after each 1v1 match).",
  hScore: "How SCORE is computed",
  p2: "For each difficulty, two normalized values are computed: winrate = VM/SM (0–1) and ppmNorm = 1 − clamp(PPM/2000, 0, 1) (0–1).",
  p3: "Per difficulty: skill = 0.5·winrate + 0.5·ppmNorm. Difficulties are combined with weights: Easy 1, Medium 4, Hard 8, and each difficulty also gets a match factor m = clamp(SM/20, 0, 1).",

  hFormula: "Formula",
  formula:
    "ppmNorm_d = 1 - clamp(PPM_d / 2000, 0, 1)\n" +
    "winrate_d = VM_d / SM_d\n" +
    "skill_d = 0.5 * winrate_d + 0.5 * ppmNorm_d\n" +
    "m_d = clamp(SM_d / 20, 0, 1)\n" +
    "w_d: Easy=1, Medium=4, Hard=8\n" +
    "S_skill = (Σ (w_d * m_d * skill_d)) / (Σ (w_d * m_d))\n" +
    "F_level = 1 + (Lvl / 100)\n" +
    "SCORE = round(10000 * S_skill * F_level)",

  hElo: "What ELO is",
  pElo1: "ELO is a rating system used in many competitive games. Higher ELO means stronger performance over time.",
  pElo2: "When you win a 1v1 match your ELO goes up; when you lose it goes down.",
  pElo3: "The change depends on the opponent: beating a higher-rated player gives more ELO than beating a lower-rated one.",


  hNotes: "Notes",
  p5: "The Total view uses the same computation, combining all difficulties using the weights above.",
},

aboutXp: {
  p1: "After each match you gain XP (experience). XP increases your level and reflects play time, wins, and unlocks.",
  hBreakdown: "After the match",
  p2: "Match: base XP for playing the match.",
  p3: "Win: bonus XP if you win (only shown when you win).",
  p4: "Badges: bonus XP when you unlock badges during the match (sum of badge bonuses). The Total line is the sum of everything above.",
  hBadges: "Badges",
  p5: "Badges are awarded by the server when the match ends, based on criteria (e.g. matches played, wins, streaks, precision or speed). See your badges and level in \"My progression\".",
},


    progress: {
      title: "{user} • {levelLabel} {level}",
      xpToNext: "{n} XP to next level",
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
    ctrlMagnifierHint: "Hold CTRL on your keyboard to show the magnifier",
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
    backToLogin: "Back to login",

    table: {
      scoreCol: "{name} score",
      distanceCol: "{name} distance",
      timeCol: "{name} time",
    },

    flag: "Flag",
    youMarkerTitle: "You: lon {lon}, lat {lat}, t {t}s",

    matchEnd: {
      xpGained: "XP gained",
      badgeXp: "Badge XP",
      levelUp: "Level up",
      match: "Match",
      win: "Win",
      badge: "Badge",
      total: "Total",
    },

  },

  dialogs: {
    leaveMatch: "Leave the match? This counts as a loss.",
    logoutConfirm: "Log out?",
    acceptChallenge: "Accept challenge from {from}?",
    challengeSent: "Challenge sent to {to}",
    challengeDeclined: "{to} declined the challenge.",
    challengeWentOffline: "{to} went offline / lost connection.",
    challengeNoResponse: "{to} did not respond to the challenge.",
    challengeExpired: "The challenge from {from} expired.",
    challengeCancelled: "The challenge from {from} was cancelled.",
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
