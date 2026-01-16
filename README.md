# GeoSense

GeoSense är ett snabbt **1v1-geografispel**: du får ett stadsnamn, klickar på världskartan, och spelet räknar både **precision (km fel)** och **tempo (sekunder)**. Lägre totalpoäng är bättre.

Utöver SCORE har spelet även:
- **ELO-rating** (separat ranking-spår, påverkar inte SCORE)
- **Badges + XP + levels** (progression)
- **Solo/Öva** och **Prova (gäst-session)**
- **Topplista** per svårighetsgrad (easy/medium/hard/total)
- **Bug/feature-feedback** direkt från klienten

---

## Tech stack
- **Client:** React (Vite) + Socket.io-client
- **Server:** Node.js + Express + Socket.io
- **Databas:** Supabase Postgres
- **Hosting:** Render (server) + valfri statisk hosting för client (Render/Netlify/Vercel/GitHub Pages)

---

## Projektstruktur

> Fil-listan kan variera, men strukturen är stabil.

### `/client`
- `client/src/App.jsx`  
  Root app. Navigerar mellan Login/Lobby/Game.
- `client/src/api.js`  
  REST-wrapper (auth, me/progression, leaderboards, badges, feedback).
- `client/src/components/Lobby.jsx`  
  Lobby UI: online/queueCounts, matchmaking, challenges, leaderboard, admin-ui.
- `client/src/components/Game.jsx`  
  Match UI: karta, click/timer/HUD, ready-gates, resultat, matchavslut.
- `client/src/components/Login.jsx`  
  Login + *Prova* (trial/guest).
- `client/src/styles.css`  
  UI/CSS: paneler, karta, HUD, modals.
- `client/public/world.png`  
  Kartbild.

### `/server`
- `server/index.js`
  - Express routes (auth/me/badges/progression/leaderboards/feedback)
  - Socket.io matchmaking, rounds, clicks, timeouts, walkover
  - Score-modell + anti-farm SCORE-sort
  - ELO (separat spår)
- `server/db.js`  
  Postgres pool mot Supabase.
- `server/gameLogic.js`  
  Haversine + scorer (dist + tid → score).
- `server/cities.js`  
  Stadsdata (name, lat, lon, population, countryCode, etc).
- `server/capitals.json`  
  Lista över huvudstäder (för easy/medium pool).
- `server/badgesEngine.js`  
  Badge-katalog + criteria-evaluering.

---

## Miljövariabler

### Server (`/server`)
Servern använder en vanlig Postgres-URL till Supabase:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres"
PORT=3000
SESSION_TTL_DAYS=30
```

### Client (`/client`)

```bash
VITE_API_BASE_URL="http://localhost:3000"  # eller Render-URL
```

---

## Databas (Supabase / Postgres)

Det här är **den faktiska strukturen** som spelet använder (hämtat via `information_schema`).

### Översikt

**Bas-tabeller**
- `users`
- `sessions`
- `badges`
- `user_badges`
- `xp_events`
- `elo_log`
- `feedback_reports`

**Views / sammanställningar**
- `leaderboard_wide`
- `user_badges_expanded`
- `user_progression`

> Obs: `leaderboard_wide`, `user_badges_expanded` och `user_progression` är i praktiken views i de flesta upplägg.

---

## Tabeller

### `users`
Huvudtabell för konton + all statistik.

**Kolumner (viktiga fält):**
- `id bigint` (PK)
- `username text` *(unik identifierare)*
- `password_hash text` *(argon2id, migrerar legacy sha256 vid login)*
- `played/wins/losses int`
- `total_score/avg_score float`
- `pct numeric` *(vinstprocent)*
- `hidden boolean` *(om användaren syns i topplista)*

**Progression:**
- `level int`
- `xp_total bigint`
- `xp_updated_at timestamptz`
- `badges_count int`

**Streaks & record-fält:**
- `win_streak int`
- `best_win_streak int`
- `best_win_margin numeric`
- `best_match_score numeric`

**Per svårighetsgrad:**
- `easy_played/easy_wins/easy_losses int`
- `easy_total_score double`
- `medium_played/medium_wins/medium_losses int`
- `medium_total_score double`
- `hard_played/hard_wins/hard_losses int`
- `hard_total_score double`

**ELO (separat spår):**
- `elo_rating int`
- `elo_played int`
- `elo_peak int`
- `elo_updated_at timestamptz`

---

### `sessions`
Sessions-tabell för inloggning.

- `id text` *(sessionId, skickas i header `x-session-id`)*
- `username text` *(FK → `users.username`)*
- `created_at timestamptz`
- `expires_at timestamptz`

**Viktigt:**
- Gästläget (*Prova*) kan skapa ett temporärt `users`-row eftersom `sessions.username` har FK mot `users.username`.

---

### `badges`
Badge-katalogen som servern laddar och tolkar.

- `id bigint` (PK)
- `code text` *(unik badge-id i logik)*
- `group_key text`, `group_name text` *(UI-grupper)*
- `sort_in_group int`
- `name text`
- `description text`
- `emoji text`
- `icon_url text` *(optional)*
- `criteria jsonb` *(t.ex. `{ "type": "wins_total", "min": 10 }`)*
- `xp_bonus int`
- `created_at timestamptz`

---

### `user_badges`
Logg över intjänade badges.

- `id bigint` (PK)
- `username text` *(FK → `users.username`)*
- `badge_code text` *(FK → `badges.code`)*
- `earned_at timestamptz`
- `match_id text` *(optional)*
- `meta jsonb` *(extra info kopplat till badge)*

---

### `xp_events`
Händelselogg för XP (bra för debugging + statistik).

- `id bigint` (PK)
- `username text` *(FK → `users.username`)*
- `match_id text`
- `mode text` *(t.ex. `match`, `solo`, etc.)*
- `difficulty text` *(easy/medium/hard)*
- `reason text` *(t.ex. `match`, `win_bonus`, `badge`, ...)*
- `xp_amount int`
- `created_at timestamptz`
- `meta jsonb`

---

### `elo_log`
Event-logg för ELO-uppdateringar.

- `id bigint` (PK)
- `match_id text`
- `created_at timestamptz`
- `p1 text`, `p2 text`
- `p1_before int`, `p1_after int`, `p1_delta int`
- `p2_before int`, `p2_after int`, `p2_delta int`
- `expected_p1 numeric` *(optional)*
- `k_used int` *(optional)*
- `outcome numeric` *(optional, typ 0/1/0.5)*

**Princip:**
- ELO uppdateras endast för riktiga 1v1-matcher (inte Öva/Prova/bot/walkover).

---

### `feedback_reports`
Rapporter som användare skickar via UI.

- `id bigint` (PK)
- `created_at timestamptz`
- `username text`
- `kind text` *("bug" eller "feature")*
- `message text`
- `page_url text` *(optional)*
- `user_agent text` *(optional)*
- `lang text` *(optional)*
- `meta jsonb`

---

## Views

### `leaderboard_wide`
En “wide” sammanställning som klienten använder för topplistor.

Kolumner:
- `namn text`
- `lvl int`
- `hidden boolean`

Per difficulty prefix:
- `e_*` = easy
- `m_*` = medium
- `s_*` = hard
- `t_*` = total

Nyckelfält per prefix:
- `*_sp` *(spelade matcher)*
- `*_pct` *(win rate)*
- `*_ppm` *(poäng per match — **lägre är bättre**)*
- `*_vm`, `*_fm` *(extra leaderboard-mått som används i UI)*

Exempel: `t_sp`, `t_ppm`, `e_pct`, `m_vm` …

**Servern använder dessutom ett anti-fusk-filter:**
- måste ha minst `t_sp >= 3`
- `t_ppm` måste vara rimlig (`0 < t_ppm < 15000`)

---

### `user_badges_expanded`
Join mellan `user_badges` och `badges` för enkel UI-hämtning.

Kolumner:
- `username, code, group_key, group_name, sort_in_group`
- `name, description, emoji, icon_url`
- `earned_at, match_id, meta`

---

### `user_progression`
Sammanställning för progression.

Kolumner:
- `username`
- `level`
- `xp_total`
- `xp_updated_at`

---

## Relationsdiagram (FK)

```text
users.username
  ├─< sessions.username
  ├─< user_badges.username
  │      └─ user_badges.badge_code >─ badges.code
  └─< xp_events.username
```

---

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
- `round_start({ roundIndex, cityName, cityMeta })`
- `round_result({ results })`
- `ready_prompt({ roundIndex })`
- `next_round_countdown({ seconds })`
- `match_finished({ totalScores, winner, progressionDelta, finishReason })`

---

### REST endpoints

- `POST /api/register`
- `POST /api/login`
- `POST /api/guest` *(Prova / gäst-session)*
- `POST /api/logout` *(auth)*
- `GET /api/me` *(auth)*
- `PATCH /api/me/leaderboard-visibility` *(auth)*
- `GET /api/badges` *(auth)*
- `GET /api/me/progression` *(auth)*
- `GET /api/users/:username/progression` *(auth)*
- `GET /api/leaderboard-wide?mode=easy|medium|hard|total&sort=...&dir=...&limit=...`
- (Legacy/kompat) `GET /api/leaderboard`

---

## Spelregler (kort)

- Match: **10 rundor**
- Timeout per runda: **20s**
- Mellan rundor: intermission + redo-gate + countdown
- Solo/Öva/Prova ska **inte** påverka topplista/badges/ELO

---

## Lokalt: körning

### 1) Installera allt

```bash
npm run install-all
```

### 2) Starta server

```bash
npm run dev-server
```

### 3) Starta client

```bash
npm run dev-client
```

---

## SQL: snabb schema-audit (Supabase)

Tabeller + views:
```sql
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;
```

Kolumner:
```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

Foreign keys:
```sql
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as foreign_table,
  ccu.column_name as foreign_column
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY';
```
