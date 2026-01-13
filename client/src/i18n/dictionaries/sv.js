export default {
  common: {
    appName: "GeoSense",
    language: "Språk",
    other: "Övrigt",
    loading: "Loggar in. Vänta...",
    close: "Stäng",
    logout: "Logga ut",
    leave: "Lämna",
    ok: "OK",
    cancel: "Avbryt",
    auto: "Auto",
    asc: "Stigande",
    desc: "Fallande",
    level: "Level",
    badges: "Badges",
    xp: "XP",
    hoverForInfo: "Hovra för info",
    difficulty: {
      easy: "Enkel",
      medium: "Medel",
      hard: "Svår",
      total: "Total",
    },
    modes: {
      practice: "Öva",
    },
  },

  mobile: {
    blocked: "GeoSense är byggt för desktop just nu.",
  },

  login: {
    headline: "GeoSense",
    blurb:
      "En snabb kartbattle: du får en stad, klickar på kartan och tävlar om att vara både närmast och snabbast.",
    noEmailTitle: "Ingen e-post behövs.",
    noEmailBody: "Välj ett användarnamn (det blir ditt smeknamn i spelet) och ett lösenord. Vi sparar bara användarnamn + lösenord för att kunna spara din progression.",
    usernamePlaceholder: "t.ex. RymdRäven (inte e-post)",
    usernameHelp: "Skriv inte din e-post. Användarnamnet syns för andra i spelet.",
    emailDetected: "Det där ser ut som en e-postadress. Använd ett smeknamn i stället.",

    username: "Användarnamn",
    password: "Lösenord",
    loginBtn: "Logga in",
    registerBtn: "Skapa konto",
    loggingIn: "Loggar in…",
    registering: "Skapar konto…",
    hint:
      " ",
    copy: "© {year} GeoSense",
  },

  lobby: {
    aboutTitle: "Vad är GeoSense?",
    leaderboard: "Topplista",
    myProgress: "Min progression",
    loggedInAs: "Inloggad som: {user}",
    onlineNowCount: "Online just nu: {n}st.",


    bugReport: "Rapportera bugg",
    bugReportTitle: "Rapportera en bugg",
    bugReportHint: "Skriv kort vad som hände. Kopiera rapporten (inkl. diagnos) och klistra in där du rapporterar – eller öppna ett mailutkast.",
    bugReportPlaceholder: "Steg för steg…\n\nFörväntat: …\nFaktiskt: …",
    bugReportCopy: "Kopiera rapport",
    bugReportCopied: "Kopierat!",
    bugReportEmail: "Öppna e‑post",

    // New feedback flow (stores to Supabase via server)
    feedback: {
      title: "Skicka feedback",
      adminTitle: "Feedback (admin)",
      kindBug: "Rapportera bugg",
      kindFeature: "Förslag / funktion",
      placeholderBug: "Beskriv buggen tydligt…\n\nSteg: 1) … 2) …\nFörväntat: …\nFaktiskt: …",
      placeholderFeature: "Beskriv idén…\n\nVad vill du förbättra? Varför? Hur borde det funka?",
      send: "Skicka",
      sending: "Skickar…",
      sent: "Skickat!",
      errorEmpty: "Skriv något först.",
      filterAll: "Alla",
      filterBug: "Buggar",
      filterFeature: "Förslag",
      refresh: "Uppdatera",
      empty: "Inga poster ännu.",
      colTime: "Tid",
      colKind: "Typ",
      colUser: "User",
      colMessage: "Meddelande",
      colUrl: "URL",
      colLang: "Lang",
    },
    chat: {
      title: "Lobbychat",
      toggleShow: "Visa chat",
      toggleHide: "Dölj chat",
      placeholder: "Skriv ett meddelande…",
      send: "Skicka",
      ttl: "Försvinner efter 5 min",
      empty: "Inga meddelanden ännu.",
    },
    queue: {
      ready: "redo",
    },

    matchRandom: {
      title: "Match mot slumpvis",
      readyUp: "Ställ mig redo",
      leaveQueue: "Lämna kö",
    },

    practice: {
      start: "Starta övning",
    },

    challenge: {
      placeholder: "Utmana användare...",
      btn: "Utmana",
    },

    lb: {
      visible: "Visas i topplistan",
      hidden: "Dold i topplistan",
      loading: "Laddar topplista…",
      empty: "Inga matcher spelade ännu.",
      player: "Spelare",
      sortOption: "Sort: {mode}",
      view: {
        all: "ALLA",
      },
      groups: {
        easy: "ENKEL",
        medium: "MEDEL",
        hard: "SVÅR",
        total: "TOTAL",
      },
    },

    about: {
      p1: "GeoSense är en snabb 1v1‑kartduell där precision och tempo avgör.",
      p2:
        "Du får ett stadsnamn. Klicka så nära staden du kan på världskartan. Ju lägre fel (km) och ju snabbare tid, desto bättre.",
      howTitle: "Hur funkar poängen?",
      p3:
        "Varje runda ger poäng baserat på både avståndsfel och tid. Du ser din poäng direkt efter klick (snabb feedback), men servern räknar det officiella resultatet.",
      p4:
        "Efter flera rundor summeras totalpoängen. Lägst total vinner matchen.",
      modesTitle: "Spellägen",
      p5:
        "1v1: du möter en annan spelare. Öva: solo‑läge där du kan träna utan stress.",
      lensTitle: "Förstoringsglaset",
      p6:
        "Linsen hjälper dig sikta mer exakt. Efter att du klickat döljs den tills det är 1 sekund kvar på nedräkningen till nästa stad.",
      progressTitle: "Progression",
      p7:
        "Du kan låsa upp badges genom att spela och uppfylla villkor. Vissa badges kräver precision, andra snabbhet eller streaks.",
      p8:
        "Topplistan visar olika sorteringar och svårighetsgrader. Du kan även välja att dölja dig.",
    },

    progress: {
      title: "{user} • {levelLabel} {level}",
      xpToNext: "{n} XP till nästa level",
      statsPlayed: "Spelade",
      statsWins: "Vinster",
      statsLosses: "Förluster",
      statsWinrate: "Winrate",
      statsAvgScore: "Snittpoäng",
      statsBestMatch: "Bästa match",
      statsBestWin: "Största vinst",
      badgesLine: "{label}: {earned}/{total} • {hover}",
    },

  },

  game: {
    opponent: "Motståndare",
    waiting: "Väntar…",
    ready: "Redo",
    mapNotCalibrated: "Kartan är inte kalibrerad än.",
    debug: "Debug",
    debugOn: "Debug: PÅ",
	roundN: "Runda {n}",

    title: "GeoSense",
    loadingMap: "Laddar karta…",
    waitingForOthers: "Väntar på andra…",
    readyForNext: "Redo för nästa…",

    currentTotalScore: "Aktuell totalpoäng",
    pop: "Pop",
    nextRoundIn: "Nästa runda om",

    practiceFinished: "Övning klar",
    finalResults: "Slutresultat",
    youWon: "Du vann!",
    youLost: "Du förlorade.",
    tie: "Oavgjort.",

    city: "Stad",
    total: "Total",
    backToLobby: "Till lobby",

    table: {
      scoreCol: "{name} poäng",
      distanceCol: "{name} avstånd",
      timeCol: "{name} tid",
    },

    flag: "Flagga",
    youMarkerTitle: "Du: lon {lon}, lat {lat}, t {t}s",

    matchEnd: {
      xpGained: "XP",
      badgeXp: "Badge-XP",
      levelUp: "Level up",
      match: "Match",
      win: "Vinst",
      badge: "Badge",
      total: "Total",
    },

  },

  dialogs: {
    leaveMatch: "Vill du lämna matchen? Detta räknas som förlust.",
    logoutConfirm: "Vill du logga ut?",
    acceptChallenge: "Acceptera utmaning från {from}?",
  },

    errors: {
    // REST/HTTP errors (mapped from server)
    notLoggedIn: "Inte inloggad.",
    serverError: "Serverfel.",
    missingCreds: "Saknar användarnamn/lösen.",
    usernameTaken: "Användarnamn finns redan.",
    invalidCreds: "Fel användarnamn eller lösenord.",
    hiddenMissing: "Kolumnen \"hidden\" saknas i users.",
    userNotFound: "Hittade inte användare.",
    missingUsername: "Saknar username.",
    invalidSort: "Ogiltiga sort-parametrar.",
    apiHtml: "Servern svarade med en HTML-sida (troligen fel URL eller proxy).",
    network: "Nätverksfel. Kontrollera anslutningen.",
    timeout: "Begäran tog för lång tid (timeout).",
    requestFailed: "Begäran misslyckades.",
    leaderboardLoadFailed: "Kunde inte ladda leaderboard.",
    progressionLoadFailed: "Kunde inte ladda progression.",

    // Socket/server messages
    forcedLogout: "Du blev utloggad eftersom du loggade in i en annan flik.",
    sessionInvalid: "Ogiltig session, logga in igen.",
    authServer: "Serverfel vid auth.",
    alreadyInMatch: "Du är redan i en match.",

    challengeSelf: "Du kan inte utmana dig själv 😅",
    playerNotOnline: "Spelaren är inte online",
    playerBusy: "Spelaren är upptagen i en match",
    challengerNotOnline: "Utmanaren är inte längre online",
    challengerBusy: "Utmanaren är upptagen i en match",
    challengeNotForYou: "Utmaningen är inte riktad till dig.",
    challengeInvalid: "Utmaningen är ogiltig eller har gått ut.",

    // Generic
    unknown: "Något gick fel.",
  },
};
