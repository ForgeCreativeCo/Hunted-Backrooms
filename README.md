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

## Sound

Recorded clips live in `public/audio`; everything else is synthesized in `src/audio.ts`.

| File | Plays when | Source file (Pixabay uploader) |
| --- | --- | --- |
| `ambience.mp3` | Looping room tone all night | backrooms-ambience-2 (godbi_3) |
| `roar.mp3` | A wanderer sees you up close (one of five roars, picked at random) | glitchy-roar (distancingmyselffromthis) |
| `jumpscare.mp3` | You catch someone | backrooms-smiler-jumpscare (unr3al_backr00ms) |
| `wail.mp3` | A wanderer escapes | creature-wail (distancingmyselffromthis) |
| `distant-screams.mp3` | Every minute or two, somewhere far off | creature-screams-in-the-distance (distancingmyselffromthis) |
| `scream-a.mp3`, `scream-b.mp3` | A wanderer panics, sees you face to face, or is caught. Each wanderer has one of the two voices | scared-woman-scream, male-horror-scream (universfield) |
| `breathing-1.mp3`, `breathing-2.mp3` | A scared, winded or hiding wanderer, audible only up close. Hiding in the dark, they hold their breath | scared_breathing1, scared-breathing-2 (freesound_community) |

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
