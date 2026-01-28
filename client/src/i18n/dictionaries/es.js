export default {
  common: {
    appName: "GeoSense",
    language: "Idioma",
    other: "Otros",
    loading: "Iniciando sesión. Espera…",
    close: "Cerrar",
    logout: "Cerrar sesión",
    leave: "Salir",
    ok: "OK",
    cancel: "Cancelar",
    auto: "Auto",
    asc: "Ascendente",
    desc: "Descendente",
    level: "Nivel",
    badges: "Insignias",
    xp: "XP",
    hoverForInfo: "Pasa el cursor para info",
    difficulty: {
      easy: "Fácil",
      medium: "Media",
      hard: "Difícil",
      total: "Total",
    },
    modes: {
      practice: "Práctica",
    },
  },

  mobile: {
    blocked: "GeoSense está pensado para escritorio por ahora.",
  },

  login: {
    headline: "GeoSense",
    blurb:
      "Una batalla de mapas rápida: recibes una ciudad, haces clic en el mapa y compites por ser el más cercano y el más rápido.",
    noEmailTitle: "No se necesita correo.",
    noEmailBody: "Elige un usuario (tu apodo en el juego) y una contraseña. Solo guardamos usuario + contraseña para poder guardar tu progreso.",
    usernamePlaceholder: "p. ej. ZorroEspacial (no correo)",
    usernameHelp: "No escribas tu correo. Tu usuario es visible para otros jugadores.",
    emailDetected: "Eso parece un correo electrónico. Usa un apodo en su lugar.",

    username: "Usuario",
    password: "Contraseña",
    loginBtn: "Entrar",
    registerBtn: "Crear cuenta",
    tryBtn: "Probar",
    startingTry: "Iniciando práctica…",
    loggingIn: "Entrando…",
    registering: "Creando cuenta…",
    promo: {
      aria: "GeoSense – información",
      title: "¿Te gusta GeoSense?",
      text:
        "¿Quieres competir contra otros? Guarda tu progreso, consigue medallas, XP y sube de nivel. Crea una cuenta y reta a amigos o a oponentes aleatorios de todo el mundo.",
    },
    hint: " ",
    copy: "© {year} GeoSense",
  },

  lobby: {
    aboutTitle: "¿Qué es GeoSense?",
    leaderboard: "Clasificación",
    leaderboardMinMatchesHint: "Juega al menos 3 partidas para aparecer en la clasificación.",
    myProgress: "Mi progreso",
    loggedInAs: "Conectado como: {user}",
    onlineNowCount: "En línea: {n}.",
    onlinePlayersTitle: "En línea",
    onlineClickToView: "Haz clic para ver la progresión",
    onlineChallenge: "Desafiar jugador",
    onlineHideMe: "Ocultarme en la lista",
    onlineShowMe: "Mostrarme en la lista",
    onlineHideMeTitle: "Controla si apareces en la lista de jugadores en línea",


    bugReport: "Reportar un bug",
    bugReportTitle: "Reportar un bug",
    bugReportHint: "Describe brevemente lo ocurrido. Copia el informe (incl. diagnósticos) y pégalo donde reportes errores — o abre un borrador de correo.",
    bugReportPlaceholder: "Pasos…\n\nEsperado: …\nActual: …",
    bugReportCopy: "Copiar informe",
    bugReportCopied: "¡Copiado!",
    bugReportEmail: "Abrir correo",

    // New feedback flow (stores to Supabase via server)
    feedback: {
      title: "Enviar feedback",
      adminTitle: "Feedback (admin)",
      kindBug: "Reportar bug",
      kindFeature: "Sugerencia / función",
      placeholderBug: "Describe el bug con claridad…\n\nPasos: 1) … 2) …\nEsperado: …\nActual: …",
      placeholderFeature: "Describe tu idea…\n\n¿Qué debería mejorar? ¿Por qué? ¿Cómo debería funcionar?",
      send: "Enviar",
      sending: "Enviando…",
      sent: "¡Enviado!",
      errorEmpty: "Escribe algo primero.",
      filterAll: "Todo",
      filterBug: "Bugs",
      filterFeature: "Ideas",
      refresh: "Actualizar",
      empty: "Aún no hay entradas.",
      colTime: "Hora",
      colKind: "Tipo",
      colUser: "Usuario",
      colMessage: "Mensaje",
      colUrl: "URL",
      colLang: "Idioma",
    },
    whatsNew: {
      title: "Novedades",
      adminTitle: "Publicar actualización",
      adminMissing: "Escribe un título y un texto.",
      adminSent: "¡Publicado!",
      adminTitlePlaceholder: "Título (corto)",
      adminDate: "Fecha",
      adminBodyPlaceholder: "Escribe qué hay de nuevo… (solo se muestran las 2 últimas)",
      adminPublish: "Publicar",
    },

    quickChallenge: {
      title: "Desafiar a {user}",
      pickDifficulty: "Elige dificultad:",
      send: "Enviar desafío",
    },

    chat: {
      title: "Chat de lobby",
      toggleShow: "Mostrar chat",
      toggleHide: "Ocultar chat",
      placeholder: "Escribe un mensaje…",
      send: "Enviar",
      ttl: "Desaparece en 15 min",
      empty: "Aún no hay mensajes.",
    },
    queue: {
      ready: "listo",
    },

    matchRandom: {
      title: "Partida aleatoria",
      readyUp: "Listo",
      leaveQueue: "Salir de la cola",
    },

    practice: {
      start: "Iniciar práctica",
    },

    challenge: {
      placeholder: "Retar a un usuario...",
      btn: "Retar",
    },

    lb: {
      visible: "Visible en la clasificación",
      hidden: "Oculto en la clasificación",
      loading: "Cargando clasificación…",
      empty: "Aún no hay partidas.",
      player: "Jugador",
      sortOption: "Ordenar: {mode}",
      view: {
        all: "TODO",
      },
      groups: {
        easy: "FÁCIL",
        medium: "MEDIA",
        hard: "DIFÍCIL",
        total: "TOTAL",
      },
    },

    about: {
      p1: "GeoSense es un duelo 1v1 rápido donde mandan la precisión y la velocidad.",
      p2:
        "Te sale el nombre de una ciudad. Haz clic lo más cerca posible en el mapa. Menos error (km) y menos tiempo es mejor.",
      howTitle: "¿Cómo se calcula la puntuación?",
      p3:
        "Cada ronda puntúa por error de distancia y por tiempo. Ves tu puntuación al instante tras hacer clic, pero el servidor calcula el resultado oficial.",
      p4:
        "Tras varias rondas, la puntuación total decide el ganador (gana el total más bajo).",
      modesTitle: "Modos",
      p5: "1v1: contra otra persona. Práctica: modo en solitario para entrenar.",
      lensTitle: "La lupa",
      p6:
        "Mantén CTRL para activar la lente cuando quieras más precisión. Tras tu clic, se oculta hasta que falte 1 segundo para la siguiente ciudad.",
      progressTitle: "Progresión",
      p7:
        "Desbloquea insignias jugando y cumpliendo condiciones. Algunas premian precisión, otras velocidad o rachas.",
      p8:
        "La clasificación permite varios ordenamientos y dificultades. También puedes ocultarte.",
    },

aboutTabs: {
  basic: "Básico",
  scoring: "Puntuación",
  xp: "XP y Badges",
  leaderboard: "Clasificación",
},

aboutScoring: {
  p1: "La puntuación de cada ronda es la suma de una parte de distancia y una parte de tiempo. Menor es mejor. El máximo es 2000 puntos (1000 + 1000).",
  p2: "La parte de distancia es lineal hasta 17.000 km (aprox. el antípoda). La parte de tiempo sigue una curva exponencial y se normaliza para que 20 s dé 1000 puntos.",
  hFormula: "Fórmula",
  formula:
    "distPenalty = min(distanceKm / 17000, 1)\n" +
    "tNorm = clamp(timeMs / 20000, 0, 1)\n" +
    "timePenalty = expm1(3.2 * tNorm) / expm1(3.2)\n" +
    "roundScore = 1000 * distPenalty + 1000 * timePenalty",
  hExamples: "Ejemplos",
  ex1: "34 km de error y 5,0 s: dist ≈ 34/17000 → 2 pts, tiempo ≈ 52 pts ⇒ total ≈ 54 pts.",
  ex2: "850 km de error y 2,0 s: dist ≈ 50 pts, tiempo ≈ 16 pts ⇒ total ≈ 66 pts.",
  ex3: "Sin clic dentro de 20 s: recibes la penalización máxima (≈ 2000 puntos) en esa ronda.",
},


aboutLeaderboard: {
  p1: "La clasificación muestra estadísticas por dificultad (Fácil/Medio/Difícil) y el Total. Puedes cambiar la vista y el orden.",
  hColumns: "Abreviaturas",
  colLvl: "Tu nivel (sube con XP y nunca baja).",
  colSm: "Partidas jugadas (en la dificultad seleccionada).",
  colVm: "Partidas ganadas.",
  colFm: "Partidas perdidas.",
  colPct: "Porcentaje de victoria (VM/SM). Más alto es mejor.",
  colPpm: "Puntos medios por partida (más bajo es mejor).",
  colScore: "Puntuación de ranking (más alto es mejor) calculada con % de victorias + media, ponderada por dificultad, nº de partidas y nivel.",

  colElo: "Puntuación ELO (un rating de habilidad que cambia después de cada partida 1v1).",
  hScore: "Cómo se calcula SCORE",
  p2: "Para cada dificultad se calculan dos valores normalizados: winrate = VM/SM (0–1) y ppmNorm = 1 − clamp(PPM/2000, 0, 1) (0–1).",
  p3: "Por dificultad: skill = 0.5·winrate + 0.5·ppmNorm. Luego se combinan las dificultades con pesos: Fácil 1, Medio 4, Difícil 8, y cada dificultad tiene además un factor de partidas m = clamp(SM/20, 0, 1).",

  hFormula: "Fórmula",
  formula:
    "ppmNorm_d = 1 - clamp(PPM_d / 2000, 0, 1)\n" +
    "winrate_d = VM_d / SM_d\n" +
    "skill_d = 0.5 * winrate_d + 0.5 * ppmNorm_d\n" +
    "m_d = clamp(SM_d / 20, 0, 1)\n" +
    "w_d: Fácil=1, Medio=4, Difícil=8\n" +
    "S_skill = (Σ (w_d * m_d * skill_d)) / (Σ (w_d * m_d))\n" +
    "F_level = 1 + (Lvl / 100)\n" +
    "SCORE = round(10000 * S_skill * F_level)",

  hElo: "Qué es ELO",
  pElo1: "ELO es un sistema de puntuación usado en muchos juegos competitivos. Un ELO más alto significa mejor rendimiento con el tiempo.",
  pElo2: "Cuando ganas una partida 1v1 tu ELO sube; cuando pierdes, baja.",
  pElo3: "El cambio depende del rival: vencer a alguien con ELO más alto da más que vencer a alguien con ELO más bajo.",


  hNotes: "A tener en cuenta",
  p5: "La vista Total usa el mismo cálculo, combinando todas las dificultades con los pesos anteriores.",
},

aboutXp: {
  p1: "Después de cada partida ganas XP (experiencia). La XP aumenta tu nivel y refleja cuánto juegas, ganas y desbloqueas.",
  hBreakdown: "Después de la partida",
  p2: "Partida: XP base por jugar.",
  p3: "Victoria: XP extra si ganas (solo se muestra si ganas).",
  p4: "Badges: XP extra cuando desbloqueas badges en la partida (suma de bonus de badges). La línea Total es la suma de todo lo anterior.",
  hBadges: "Badges",
  p5: "Los badges los otorga el servidor cuando termina la partida, según criterios (p. ej. partidas jugadas, victorias, rachas, precisión o velocidad). Mira tus badges y tu nivel en \"Mi progresión\".",
},


    progress: {
      title: "{user} • {levelLabel} {level}",
      xpToNext: "{n} XP para el siguiente nivel",
      statsPlayed: "Jugadas",
      statsWins: "Victorias",
      statsLosses: "Derrotas",
      statsWinrate: "Porcentaje",
      statsAvgScore: "Media",
      statsBestMatch: "Mejor partida",
      statsBestWin: "Mejor victoria",
      badgesLine: "{label}: {earned}/{total} • {hover}",
    },

  },

  game: {
    opponent: "Rival",
    waiting: "Esperando…",
    ready: "Listo",
    mapNotCalibrated: "El mapa aún no está calibrado.",
    debug: "Debug",
    debugOn: "Debug: ON",
	roundN: "Ronda {n}",

    title: "GeoSense",
    loadingMap: "Cargando mapa…",
    waitingForOthers: "Esperando a otros…",
    readyForNext: "Listo para la siguiente…",
    ctrlMagnifierHint: "Mantén presionada la tecla CTRL para mostrar la lupa",

    currentTotalScore: "Puntuación total actual",
    pop: "Pob.",
    nextRoundIn: "Siguiente ronda en",

    practiceFinished: "Práctica terminada",
    finalResults: "Resultados finales",
    youWon: "¡Ganaste!",
    youLost: "Perdiste.",
    tie: "Empate.",

    city: "Ciudad",
    total: "Total",
    backToLobby: "Volver al lobby",
    backToLogin: "Volver al inicio",

    table: {
      scoreCol: "{name} puntos",
      distanceCol: "{name} distancia",
      timeCol: "{name} tiempo",
    },

    flag: "Bandera",
    youMarkerTitle: "Tú: lon {lon}, lat {lat}, t {t}s",

    matchEnd: {
      xpGained: "XP ganado",
      badgeXp: "XP de insignias",
      levelUp: "Subes de nivel",
      match: "Partida",
      win: "Victoria",
      badge: "Insignias",
      total: "Total",
    },

  },

  dialogs: {
    leaveMatch: "¿Salir de la partida? Esto cuenta como derrota.",
    logoutConfirm: "¿Cerrar sesión?",
    acceptChallenge: "¿Aceptar el reto de {from}?",
    challengeSent: "Reto enviado a {to}",
    challengeDeclined: "{to} rechazó el reto.",
    challengeWentOffline: "{to} se desconectó / perdió la conexión.",
    challengeNoResponse: "{to} no respondió al reto.",
    challengeExpired: "El reto de {from} expiró.",
    challengeCancelled: "El reto de {from} se canceló.",
  },

    errors: {
    // REST/HTTP errors (mapped from server)
    notLoggedIn: "No has iniciado sesión.",
    serverError: "Error del servidor.",
    missingCreds: "Falta usuario/contraseña.",
    usernameTaken: "El nombre de usuario ya existe.",
    invalidCreds: "Usuario o contraseña incorrectos.",
    hiddenMissing: "Falta la columna \"hidden\" en users.",
    userNotFound: "Usuario no encontrado.",
    missingUsername: "Falta username.",
    invalidSort: "Parámetros de ordenación inválidos.",
    apiHtml: "El servidor devolvió una página HTML (probable URL incorrecta o proxy).",
    network: "Error de red. Comprueba tu conexión.",
    timeout: "La solicitud excedió el tiempo de espera.",
    requestFailed: "La solicitud falló.",
    leaderboardLoadFailed: "No se pudo cargar la clasificación.",
    progressionLoadFailed: "No se pudo cargar la progresión.",

    // Socket/server messages
    forcedLogout: "Se cerró tu sesión porque iniciaste sesión en otra pestaña.",
    sessionInvalid: "Sesión inválida, vuelve a iniciar sesión.",
    authServer: "Error del servidor durante la autenticación.",
    alreadyInMatch: "Ya estás en una partida.",

    challengeSelf: "No puedes retarte a ti mismo 😅",
    playerNotOnline: "El jugador no está en línea",
    playerBusy: "El jugador está ocupado en una partida",
    challengerNotOnline: "El retador ya no está en línea",
    challengerBusy: "El retador está ocupado en una partida",
    challengeNotForYou: "Ese reto no está dirigido a ti.",
    challengeInvalid: "El reto es inválido o ha expirado.",

    // Generic
    unknown: "Algo salió mal.",
  },
};
