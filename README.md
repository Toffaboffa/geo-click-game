# GeoSense

GeoSense är ett snabbt 1v1-geografispel: du får ett stadsnamn, klickar på världskartan, och spelet räknar både precision (km fel) och tempo (sekunder). Lägre totalpoäng är bättre.

## Tech stack
- Client: React (Vite)
- Server: Node.js + Express + Socket.io
- DB: Supabase Postgres
- Hosting: Render (server) + valfri statisk hosting för client (Render/Netlify/Vercel)

## Projektstruktur

> Exakt fil-lista kan variera, men strukturen följer detta.

### /client
- `client/src/App.jsx`  
  Root app. Navigerar mellan Login/Lobby/Game.
- `client/src/api.js`  
  REST-wrapper: login, me, leaderboards, badges, progression.
- `client/src/components/Lobby.jsx`  
  Lobby UI: online/queueCounts, köval med svårighet, challenge (utmana spelare), leaderboard-toggle.
- `client/src/components/Game.jsx`  
  Match UI: karta, click/timer/HUD, round_result, match_finished, ready-gates.
- `client/src/styles.css`  
  UI/CSS inklusive kartbakgrund, paneler, HUD, modals.
- `client/public/world.png`  
  Kartbild.
- `client/public/world_debug.png` (om finns)  
  Debugkarta.
- `client/src/assets/*` (om finns)  
  Bakgrunder/ikoner.

### /server
- `server/index.js`  
  Huvudserver:
  - Express routes (auth/me/badges/progression/leaderboards)
  - Socket.io matchning, rounds, clicks, timeouts, walkover
  - City pools per difficulty (easy/medium/hard)
- `server/db.js`  
  DB-connector/pool (Postgres/Supabase).
- `server/gameLogic.js`  
  Haversine + scorer (dist + tid → score).
- `server/cities.js`  
  Stadsdata (name, lat, lon, population, countryCode, etc).
- `server/capitals.json`  
  Lista över huvudstäder (används för easy/medium pool).
- `server/badgesEngine.js`  
  Badge-katalog + criteria evaluation + mapping.

## Databas (Supabase)

### Tabeller
- `users`
  - Bas: `username`, `password_hash`, `played`, `wins`, `losses`, `total_score`, `avg_score`, `pct`, `hidden`
  - Progression: `level`, `badges_count`, `win_streak`, `best_win_streak`, `best_win_margin`, m.fl.
  - Per difficulty:
    - `easy_played`, `easy_wins`, `easy_losses`, `easy_total_score`
    - `medium_played`, `medium_wins`, `medium_losses`, `medium_total_score`
    - `hard_played`, `hard_wins`, `hard_losses`, `hard_total_score`
- `sessions`
  - `id`, `username`, `expires_at`, `created_at`
- `badges`
  - `code`, `name`, `description`, `emoji`, `criteria` (jsonb), group-fields
- `user_badges`
  - `username`, `badge_code`, `earned_at`, `match_id`, `meta` (jsonb)

### Views
- `leaderboard_wide`
  Sammanställer easy/medium/hard/total i en “wide”-form.
- `user_badges_expanded`
  Join mellan `user_badges` och `badges`.

### RLS / Policies
Spelet förutsätter att Supabase-policies tillåter läsning av åtminstone badges och leaderboard-data (beroende på hur du valt att exponera endpoints).

## Kritiska kopplingspunkter (får inte gå sönder)

### Socket events

Client → Server:
- `auth(sessionId)`
- `start_random_match({ difficulty })`
- `set_queue({ queued, difficulty })`
- `leave_queue`
- `start_solo_match({ difficulty })`
- `challenge_player({ targetUsername, difficulty })`
- `accept_challenge({ challengeId })`
- `decline_challenge({ challengeId })`
- `leave_match({ matchId })`
- `player_start_ready({ matchId })`
- `player_click({ matchId, lon, lat, timeMs })`
- `player_ready({ matchId, roundIndex })`

Server → Client:
- `auth_error(message)`
- `forced_logout(message)`
- `lobby_state({ onlineCount, queueCounts:{ easy, medium, hard } })`
- `queue_state({ queued, difficulty })`
- `challenge_received({ from, difficulty, challengeId })`
- `challenge_sent({ to, difficulty, challengeId })`
- `challenge_declined({ to, challengeId })`
- `match_started({ matchId, players, totalRounds, isSolo, isPractice, difficulty })`
- `start_ready_prompt`
- `round_start({ roundIndex, cityName, cityMeta:{ name, countryCode, population, isCapital } })`
- `round_result({ results })`
  - `results[player]` innehåller `{ lon, lat, timeMs, distanceKm, score }`
- `ready_prompt({ roundIndex })`
- `next_round_countdown({ seconds })`
- `match_finished({ totalScores, winner, progressionDelta, finishReason })`

Vanligaste orsaken till “de pratar inte med varandra” är att event-namn eller payload-fält ändrats på ena sidan men inte den andra.

### REST endpoints

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout` (auth)
- `GET /api/me` (auth)
- `PATCH /api/me/leaderboard-visibility` (auth)
- `GET /api/badges` (auth)
- `GET /api/me/progression` (auth)
- `GET /api/users/:username/progression` (auth)
- `GET /api/leaderboard-wide?mode=easy|medium|hard|total&sort=...&dir=...&limit=...`
- (Legacy/kompat) `GET /api/leaderboard` kan finnas för äldre klienter

## Spelregler

- Match: 10 rundor.
- Varje runda:
  1) Server väljer stad ur pool baserat på svårighetsgrad.
  2) Server skickar `round_start`.
  3) Spelarna klickar på kartan.
  4) Server räknar `distanceKm` via Haversine och `score` via scorer.
  5) Server skickar `round_result`.
- Timeout per runda: 20s.
  - Om ingen klickar: server sätter straffresultat (max tid + max dist).
- Mellan rundor: intermission med “ready”-gate och countdown.
- Solo/practice: ska inte påverka leaderboard eller badges.

## Svårighetsgrader

- Easy: huvudstäder + städer med population ≥ 1 000 000.
- Medium: Easy + städer med population ≥ 200 000.
- Hard: alla städer i spelet.

Servern bygger pools (easy/medium/hard) från `cities.js` + `capitals.json`.

## Leaderboards

Spelet stödjer en “wide leaderboard” med separat statistik för:
- easy
- medium
- hard
- total

Client växlar läge med toggle och hämtar data via `/api/leaderboard-wide`.

## Badges & progression

- Badge-defs finns i `badges`-tabellen (criteria som jsonb).
- Earned badges loggas i `user_badges`.
- Server kan skicka `progressionDelta` i `match_finished` efter en riktig match (inte practice).

## Lokalt: körning

### 1) Server
- Installera dependencies i `/server`
- Sätt miljövariabler för DB (Supabase Postgres)
- Starta servern (port 3000 som default)

### 2) Client
- Installera dependencies i `/client`
- Sätt API/Socket URL mot server (lokalt eller Render)
- Starta Vite dev server

## Testchecklista innan deploy

- Register/login fungerar (session skapas, `auth` via socket fungerar).
- Lobby visar `onlineCount` + `queueCounts` korrekt.
- Queue:
  - Ställ dig i kö på easy/medium/hard.
  - Match startar när två spelare är i samma difficulty.
- Challenge:
  - Utmana användare med vald difficulty.
  - Mottagaren får popup och kan acceptera/avböja.
- Matchflöde:
  - `match_started` → `start_ready_prompt` → `round_start`
  - Klick ger `round_result` med `distanceKm` och `score`
  - Timeout ger straffresultat
  - `match_finished` ger totals + winner
- Leaderboard-wide:
  - Toggle mellan easy/medium/hard/total och rimlig sortering.
- Badges/progression:
  - Efter riktig match uppdateras earned badges och progressionDelta (om aktiverat).

## SQL: snabb schema-audit (Supabase)

Kör i Supabase SQL Editor för att få en sammanfattning av tabeller/kolumner/views.

```sql
select
  (select jsonb_agg(table_name order by table_name)
   from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE') as tables,
  (select jsonb_agg(
      jsonb_build_object('table', table_name, 'column', column_name, 'type', data_type)
      order by table_name, column_name
   )
   from information_schema.columns
   where table_schema='public') as columns,
  (select jsonb_agg(
      jsonb_build_object('view', table_name, 'definition', view_definition)
      order by table_name
   )
   from information_schema.views
   where table_schema='public') as views;
