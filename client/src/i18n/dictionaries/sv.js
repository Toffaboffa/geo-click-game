export default {
  common: {
    appName: "GeoSense",
    language: "Språk",
    other: "Övrigt",
    loading: "Laddar",
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
      ttl: "Försvinner efter 15 min",
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
        "Håll inne CTRL för att aktivera linsen när du vill sikta mer exakt. Efter att du klickat döljs den tills det är 1 sekund kvar på nedräkningen till nästa stad.",
      progressTitle: "Progression",
      p7:
        "Du kan låsa upp badges genom att spela och uppfylla villkor. Vissa badges kräver precision, andra snabbhet eller streaks.",
      p8:
        "Topplistan visar olika sorteringar och svårighetsgrader. Du kan även välja att dölja dig.",
    },

aboutTabs: {
  basic: "Grund",
  scoring: "Poängräkning",
  xp: "XP & Badges",
  leaderboard: "Topplista",
},

aboutScoring: {
  p1: "Poängen per runda är summan av en avståndsdel och en tidsdel. Lägre är bättre. Max är 2000 poäng (1000 + 1000).",
  p2: "Avståndsdelen är linjär upp till 17 000 km (ungefär jordens antipod). Tidsdelen växer enligt en exponentiell kurva och normaliseras så att 20 s ger 1000 poäng.",
  hFormula: "Formel",
  formula:
    "distPenalty = min(distanceKm / 17000, 1)\n" +
    "tNorm = clamp(timeMs / 20000, 0, 1)\n" +
    "timePenalty = expm1(3.2 * tNorm) / expm1(3.2)\n" +
    "roundScore = 1000 * distPenalty + 1000 * timePenalty",
  hExamples: "Exempel",
  ex1: "34 km fel och 5,0 s: dist ≈ 34/17000 → 2 poäng, tid ≈ 52 poäng ⇒ totalt ≈ 54 poäng.",
  ex2: "850 km fel och 2,0 s: dist ≈ 50 poäng, tid ≈ 16 poäng ⇒ totalt ≈ 66 poäng.",
  ex3: "Ingen klick inom 20 s: du får maxstraff (≈ 2000 poäng) den rundan.",
},


aboutLeaderboard: {
  p1: "Topplistan visar statistik per svårighetsgrad (Enkel/Medel/Svår) samt Total. Du kan byta vy och sortering.",
  hColumns: "Förkortningar",
  colLvl: "Din level (ökar med XP och minskar aldrig).",
  colSm: "Spelade matcher (spelade totalt i vald svårighet).",
  colVm: "Vunna matcher.",
  colFm: "Förlorade matcher.",
  colPct: "Vinstprocent (VM/SM). Högre är bättre.",
  colPpm: "Genomsnittlig poäng per match (lägre är bättre).",
  colScore: "En sammanvägd rank‑poäng som väger in prestation, svårighet, matcher och level.",

  hScore: "Vad vägs in i SCORE?",
  p2: "SCORE bygger på både vinstprocent och PPM, men Medel och Svår väger mycket tyngre än Enkel.",
  p3: "SCORE tar också hänsyn till hur många matcher du spelat på varje svårighet (få matcher ger mindre genomslag).",
  p4: "För att undvika att man bara spelar Enkel finns en svårighets‑bonus: du når högre potential när du visar form på Medel/Svår.",

  hFormula: "Förenklad formel (idé)",
  formula:
    "SCORE ≈ 10000 · S_skill · M_diff · F_matches · F_level\n" +
    "S_skill = viktat snitt av (winrate + PPM) per svårighet\n" +
    "Vikter: Easy 1, Medium 4, Hard 8 (kräver matcher för fullt genomslag)",

  hNotes: "Bra att veta",
  p5: "Har du få matcher blir SCORE mer osäker. När du spelar fler matcher (särskilt på Medel/Svår) blir rankingen stabilare.",
},

aboutXp: {
  p1: "Efter varje match får du XP (erfarenhet). XP ökar din level och visar hur mycket du spelat, vunnit och låst upp.",
  hBreakdown: "Efter matchen",
  p2: "Match: grund‑XP för att spela matchen.",
  p3: "Vinst: extra XP om du vinner (visas bara när du vunnit).",
  p4: "Badges: extra XP när du låser upp badges i matchen (summa av badge‑bonusar). Total‑raden är summan av allt ovan.",
  hBadges: "Badges",
  p5: "Badges delas ut av servern när matchen är klar, baserat på kriterier (t.ex. antal matcher, vinster, streaks, precision eller snabbhet). Du ser dina badges och din level i \"Min progression\".",
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
    ctrlMagnifierHint: "Håll in CTRL på tangentbordet för att visa förstoringsglaset",

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
