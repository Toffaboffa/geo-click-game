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
    username: "Usuario",
    password: "Contraseña",
    loginBtn: "Entrar",
    registerBtn: "Crear cuenta",
    loggingIn: "Entrando…",
    registering: "Creando cuenta…",
    hint: " ",
    copy: "© {year} GeoSense",
  },

  lobby: {
    aboutTitle: "¿Qué es GeoSense?",
    leaderboard: "Clasificación",
    myProgress: "Mi progreso",
    loggedInAs: "Conectado como: {user}",
    onlineNowCount: "En línea: {n}.",


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
    chat: {
      title: "Chat de lobby",
      toggleShow: "Mostrar chat",
      toggleHide: "Ocultar chat",
      placeholder: "Escribe un mensaje…",
      send: "Enviar",
      ttl: "Desaparece en 5 min",
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
        "La lente ayuda a apuntar con más precisión. Tras tu clic, se oculta hasta que falte 1 segundo para la siguiente ciudad.",
      progressTitle: "Progresión",
      p7:
        "Desbloquea insignias jugando y cumpliendo condiciones. Algunas premian precisión, otras velocidad o rachas.",
      p8:
        "La clasificación permite varios ordenamientos y dificultades. También puedes ocultarte.",
    },

    progress: {
      title: "{user} • {levelLabel} {level}",
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

    table: {
      scoreCol: "{name} puntos",
      distanceCol: "{name} distancia",
      timeCol: "{name} tiempo",
    },

    flag: "Bandera",
    youMarkerTitle: "Tú: lon {lon}, lat {lat}, t {t}s",
  },

  dialogs: {
    leaveMatch: "¿Salir de la partida? Esto cuenta como derrota.",
    logoutConfirm: "¿Cerrar sesión?",
    acceptChallenge: "¿Aceptar el reto de {from}?",
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
