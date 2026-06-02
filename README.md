# Tic Tap Toe Socket

A two-player tic-tac-toe app powered by Express and Socket.IO.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3500` in two browser tabs. Create a room in one tab, then join it from the public lobby or with the room code in the other tab.

## Rules

- Rooms are limited to two players.
- The server assigns `X` and `O`; clients only submit board positions.
- The first room creator starts as `X`.
- Rematches alternate `X` and `O`.
- If a player leaves or disconnects, the match resets and the remaining player waits for a new opponent.

## Scripts

```bash
npm run dev
npm run build
npm start
npm test
```
