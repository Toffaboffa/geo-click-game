# GeoSense

GeoSense är ett snabbt, nervigt och beroendeframkallande kartspel där du tränar din geografiska intuition på riktigt: var ligger staden – exakt?
Du får ett stadsnamn, du klickar på världskartan, och spelet mäter både precision (hur många km fel) och tempo (hur snabbt du hinner klicka).

Det är lika delar “geografi”, “reaktion” och “kallsvettig finalsekund”.

## Funktioner

- 1 mot 1 (random matchmaking) via WebSocket
- Direktutmaning av spelare som är online
- Övningsläge (solo)
- 10 rundor per match, med timer/timeout
- Resultattabell per match (avstånd + tid + rundpoäng)
- Topplista (Top 20) med statistik (matcher, vinster/förluster, winrate, snittpoäng)
- Val att dölja sig från topplistan
- Progression: level + badges (klicka på namn i topplistan för att se en profils progression)

## Repo-struktur

- `client/` – Frontend (React + Vite)
- `server/` – Backend (Node.js + Express + socket.io)
- `docs/` – Byggd frontend (för statisk hosting)

## Teknik

- Frontend: React, Vite, socket.io-client
- Backend: Node.js, Express, socket.io
- Databas: Postgres (t.ex. Supabase)
- Kommunikation:
  - REST för auth/leaderboard/progression
  - WebSocket (socket.io) för matchflöde i realtid

## Kom igång lokalt

### 1) Förutsättningar

- Node.js (LTS rekommenderas)
- Postgres (lokalt eller via Supabase)

### 2) Installera dependencies

I två terminaler:

```bash
cd server
npm install
