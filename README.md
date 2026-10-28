# HUM — prototype

You play the thing in the Backrooms, hunting the people who noclip in and feeding on their fear before they find an exit.

This is the Phase 1 prototype from the design doc. It exists to answer one question: is stalking and scaring AI prey fun for ten minutes?

## Run

```bash
npm install
npm run dev
```

Open the printed URL in a desktop browser. Every night has a seed in the URL (`?seed=damp-1234`), so a night can be replayed or shared.

`npm run sim` runs 20 headless nights with an idle monster and prints escape times (add `-- --chase` to run a bot that chases). Use it when tuning `src/config.ts`.

## What's in it

- One procedurally generated Level 0 floor with 2 exits, light circuits and pillars
- Hunt view (first person, grain and colour fringe) and sense view (sound map), switched with Tab
- Three wanderers: two Panickers and one Mapper who chalks junctions
- Fear meters, dread, Blackout, Shift, Seep, chalk erase/redraw
- Catching, fear scoring, an 8-minute night, stars and a quota

## Layout

| File | What it does |
| --- | --- |
| `src/config.ts` | Every tuning number |
| `src/level.ts` | Seeded grid generation, walls as edges, BFS, line of sight |
| `src/game.ts` | Rules, the wanderer state machine, abilities. No rendering, so the sim can run it |
| `src/world3d.ts` | Three.js hunt view |
| `src/sense.ts` | Canvas sense view |
| `src/audio.ts` | Synthesized positional audio, one hum per light circuit |
| `src/main.ts` | Input, HUD, game loop |
