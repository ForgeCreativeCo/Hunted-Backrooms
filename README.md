# HUM — prototype

You play the thing in the Backrooms, hunting the people who noclip in and feeding on their fear before they find an exit. Play it solo against AI prey, or online: one player is the monster, up to four play the humans.

This started as the Phase 1 prototype from the design doc, which asks one question: is stalking and scaring prey fun for ten minutes?

## Run

```bash
npm install
npm run dev
```

This starts the game server (port 8787) and the client (port 5173) together. Open http://localhost:5173 in a desktop browser.

- **Play solo** is the original prototype. Every solo night has a seed in the URL (`?seed=damp-1234`), so a night can be replayed or shared.
- **Multiplayer** lists six rooms, each showing who is waiting or whether a night is under way. Pick one and join; the first player in becomes its host. Everyone picks a side and readies up, then the host starts the night. A room holds 5 players and resets when it empties.

To play with people on other machines, use the production server below: it serves the game and the multiplayer connection from one port, so that's the only one others need to reach.

## The level

Every night is generated from its seed, so online players all walk the same building.

- Rooms come in odd sizes: endless one-cell halls, huge pillared halls, closets. Some ceilings are cramped; some rise far higher than the building around them could allow.
- Doors open when you walk into them, and close themselves when nobody is watching. Doorway doors lead on. Doors hung on walls mostly lead nowhere: bricks, a black void, another door, or a door too high to reach. A few pairs of tall doors open onto the dark and carry you to their partner somewhere else in the level.
- Furniture is everywhere it shouldn't be: toppled office chairs, chairs stuck to the ceiling, circles of chairs facing nothing, chairs stacked into the ceiling, desks fused into walls, dinner set for nobody, CRTs glowing at the wall, mannequins, stairs that climb into the ceiling. Somewhere, an old phone rings.

## Multiplayer

- The server runs the real night (AI, fear, abilities, catches) and streams it to everyone 30 times a second. Each player moves themselves and the server checks the move; a move that's too fast is snapped back.
- AI wanderers fill the empty human slots, so there are always at least three prey and the monster can't be sure who's real. If a human player drops out mid-night, an AI takes over their body. If the monster drops out, the night ends.
- Humans have no map. They get first-person eyes, a stick of chalk and a flashlight with about 90 seconds of battery.
- The monster wins if it harvests the fear quota before dawn; otherwise the humans win.

| Human controls | |
| --- | --- |
| `WASD` / mouse | Move and look |
| `Shift` | Sprint (uses stamina) |
| `C` | Crouch: slow, nearly silent, and holding still in the dark you hold your breath |
| `F` | Flashlight. Lets you see in a blackout, slows the monster to half speed and blocks its abilities while it's in the beam |
| `E` | Draw a chalk arrow at your feet, pointing the open way you face |

Caught or escaped humans spectate the rest of the night on the full map.

## Hosting online

```bash
npm run build
npm start
```

`npm start` runs one Node process that serves the built game and the WebSocket on `PORT` (default 8787). Netlify and other static hosts can't run it; use a host with long-running Node processes such as Render, Fly.io or Railway. Point it at `npm install && npm run build` to build and `npm start` to run.

## Checks

- `npm run sim` runs 20 headless solo nights with an idle monster and prints escape times (add `-- --chase` for a bot that chases). Use it when tuning `src/config.ts`.
- `npm run net-test` runs bot clients against a running server (start one first with `npm run dev`) and checks the rooms, roles, movement validation, abilities, chalk, flashlight and disconnects.

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
| `src/level.ts` | Seeded generation: rooms, ceiling heights, doors, furniture; walls as edges, BFS, line of sight |
| `src/game.ts` | Rules, the wanderer state machine, abilities, human players and flashlights. No rendering, so the server and the sim can run it |
| `src/world3d.ts` | Three.js first-person view for the monster and for humans |
| `src/person.ts`, `src/creature.ts` | The wanderers' bodies, and the monster's as humans see it |
| `src/props.ts` | Furniture and debris, merged into a few meshes |
| `src/sense.ts` | Canvas sense view (and the spectator map) |
| `src/audio.ts` | Positional audio: recorded clips, per-circuit hum, heartbeat |
| `src/lobby.ts` | Multiplayer menu and lobby screens |
| `src/net/protocol.ts` | Messages and snapshot packing shared by client and server |
| `src/main.ts` | Sessions (solo or online), input, HUD, game loop |
| `server/index.ts` | Game server: lobbies, the authoritative night, static files |
