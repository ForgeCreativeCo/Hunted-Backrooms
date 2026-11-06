# HUM: A Backroom Story

You play the thing in the Backrooms, hunting the people who noclip in and feeding on their fear before they find an exit. Play it solo against AI prey, or online: one player is the monster, up to four play the humans.

This started as the Phase 1 prototype from the design doc, which asks one question: is stalking and scaring prey fun for ten minutes?

## Run

```bash
npm install
npm run dev
```

This starts the game server (port 8787) and the client (port 5173) together. Open http://localhost:5173 in a browser. Phones and tablets get touch controls.

- **Play solo** is the original prototype. Every solo run has a seed in the URL (`?seed=damp-1234`), so a run can be replayed or shared.
- **Multiplayer** lists six rooms, each showing who is waiting or whether a run is under way. Pick one and join; the first player in becomes its host. Everyone picks a side and readies up, then the host starts the run. A room holds 5 players and resets when it empties.

To play with people on other machines, use the production server below: it serves the game and the multiplayer connection from one port, so that's the only one others need to reach.

## The descent

A run is a descent through the Backrooms. Every exit leads one level deeper, and nothing leads back.

- The first wanderer through an exit starts the exits dying: every exit sign stutters, and everyone (monster too) sees a countdown (45 seconds on the first level, shorter deeper down). Anyone who reaches any exit before it ends goes too.
- A level ends when the exits close, when nobody is left wandering it, or at dawn. Whoever got out goes down to the next level; anyone still inside is lost with it.
- Only the people who got out arrive in the next level, together. Nobody new joins below the first level.
- What carries over: fear (eased by 30%), flashlight battery, and chalk. Each wanderer has 12 chalk arrows for the whole run. Stamina resets. The monster keeps half its dread (never less than it starts that depth with) and banks the fear it harvests across the run.
- The run is over when a level ends with nobody out. The end screen says how deep it got.
- Solo as the monster, **Follow them down** takes you after the survivors. Solo as a human, finding an exit lets you watch the others try for the exits until they close; then you go down together.
- Online, the next level starts for the whole room six seconds after the last one ends. A human player who didn't get out watches the rest of the run.
- Each level is one of a set of described levels (`src/levels.ts`): how it's laid out, its air, light and hum, and the line shown as you arrive. The main way down is Level 0 to Level 6 in order, then round again, darker and with fewer exits each time. Below the first level, any exit has a 1 in 5 chance of leading to a side level instead, never two in a row: the Poolrooms or the Street. After a side level the run carries on down the main way.
- Under every level, the run tightens with depth. The numbers move in a straight line between these depths and stay put below depth 12 (`dialsFor` in `src/levels.ts`; starting guesses, not tuned):

  | Depth | 1 | 4 | 8 | 12+ |
  | --- | --- | --- | --- | --- |
  | Real exits | 2 | 2 | 1 | 1 |
  | Fake exits | 0 | 1 | 2 | 3 |
  | Lit circuits | 100% | 85% | 65% | 50% |
  | Monster's starting dread | 40 | 55 | 70 | 80 |
  | Monster's fear quota | 120 | 100 | 80 | 60 |
  | Exit countdown | 45 s | 40 s | 30 s | 25 s |

- A fake exit looks and glows like a real one, but its door opens onto brick. Finding one out is a fright, and AI wanderers who do give up on it and look elsewhere. The monster's map shows fake exits dashed and marked FALSE. The quota (and the stars with it) shrinks as the humans dwindle, so a level stays winnable for the monster.
- Which level each depth is comes from the run's seed, and each level's layout from the seed and its depth (`seed:L2`, `seed:L3` …), so everyone in a room walks the same building. The HUD shows the level's name and the depth; depth is the run's score.

## The levels

Every level is generated from its seed, so online players all walk the same building.

### Level 0

- Most of Level 0 is bare: the same wallpaper, damp carpet and buzzing lights for ever. The furniture gathers in three pockets, with only the odd stray thing elsewhere.
- One region never had power. Its lights are dead and silent all night; the monster sees there in night vision, and its Blackout does nothing.
- The Pitfalls: a region of darker, soaked carpet with holes in the floor that drop away into black. You can stand at the lip but not cross.
- The Manila Room: one room walled in with as few ways in as the level allows, its wallpaper gone red.

### Level 1

- A warehouse: huge concrete halls on rows of columns, joined by wide aisles, under ceilings five to eight metres up. The lamps hang further apart than Level 0's, and the air is a thick grey fog, so wanderers see (and spot an exit from) only half as far.
- Puddles where the roof leaks. Like the Poolrooms' water, they splash: footsteps in one carry 1.7 times as far.
- Pallets of boxes against the walls, and the odd tower of boxes out in the halls.
- Eight supply crates, left by someone who came through before. Walk up to one to take what's in it: batteries (45% of a flashlight back), a box of chalk (4 more arrows), or almond water (fear down by 40, and your breath back). AI wanderers rummage through any crate they pass. Whatever you take carries on down with you.

### Level 2

- Pipe tunnels: the maze left almost as it is, narrow and low (2.4 m), opening up only in a few small pump rooms. Pipes run along most walls, and caged lamps hang far apart. The air is hot and brown.
- The heat: sprinting drains breath one and a half times as fast, and it comes back two thirds as fast.
- Sixteen steam vents, each bursting for 4.5 seconds in every 11. While one hisses, nothing within 5 m of it carries to the monster: footsteps and breathing make no pulse, and AI wanderers there can't sense the monster right behind them either. The monster's map shows each vent, and the deaf ring round it while it hisses.

### Level 3

- An electrical station: machinery halls under 4.5 to 6.5 m ceilings, with catwalks along their high walls and transformers standing between the walkways. The air is cold and blue-grey, and everything hums loudly.
- Blackouts cost half the usual dread here. But every few seconds a spark jumps somewhere dark (a dead or blacked-out circuit) and lights it for a moment, enough to be seen by.
- Machinery covers the monster: within 4.5 m of a machine, AI wanderers can't sense it right behind them. The machines also break up a human's camera picture as they pass. The monster's map shows each machine.

### Level 4

- An empty open-plan office, grey and quiet, with every light on: clusters of four cubicles across wide floors, and windows in the outer walls looking out onto black.
- A false calm. It has only one real exit, whatever the depth, and two more fake ones than the depth would give.

### Level 5

- A hotel: long straight corridors across the whole floor, red carpet, striped paper above a dark dado. Everything between the corridors is rooms, two or three cells wide, each with a numbered door, a bed and sometimes a lamp. Wanderers see a quarter further in its long, lit corridors.
- Step all the way into a room, with the monster outside it, and the door slams and locks against the monster for 10 seconds. Whoever is inside can open it again; once it unlocks, it won't lock again for 20 seconds. AI wanderers being chased make for rooms, and hide in them while the door holds.

### Level 6

- Level 0's maze with no power anywhere: every light is dead and silent, where you arrive too. The monster sees all of it in night vision, so its Blackout has nothing left to do.
- Nowhere is lit, so nowhere calms you down. The dark frightens you at half the rate of a dead region in Level 0, but it never stops, except while your flashlight is on. Batteries don't come back here.

### The Poolrooms (side level)

- The whole level is white tile and ankle-deep water, under tall ceilings and a soft light with no fittings to come from. The air is pale and clear, and the lights barely hum. One stretch is unlit.
- Every step splashes: footsteps carry 1.7 times as far, and even crouch-walking makes noise. Standing still and holding your breath still works. The monster's map shows the water in pale blue.

### The Street (side level)

- Level 0's yellow rooms, with one long hall, four rooms wide and 6.5 m tall, and a suburban street built inside it under the office ceiling. A road with a double yellow line runs down the middle, between house fronts, picket fences, mailboxes and a stop sign. Ceiling fans hang over the road, and someone stands in the middle of it, facing back up.
- The hall never touches the edge of the map at either end, so the road always leads in at both. One house, a different one every time, has its front door standing open: its narrow hall runs straight through to a back door in the wall behind, out into the maze. That door only swings outwards. A side doorway between houses is knocked through only when the level would otherwise be cut in two.

### Everywhere

- Rooms come in odd sizes: endless one-cell halls, huge pillared halls, closets. Some ceilings are cramped; some rise far higher than the building around them could allow.
- Doors open when you walk into them, and close themselves when nobody is watching. Doorway doors lead on. Doors hung on walls mostly lead nowhere: bricks, a black void, another door, or a door too high to reach. A few pairs of tall doors open onto the dark and carry you to their partner somewhere else in the level.
- Where there is furniture, it's wrong: toppled office chairs, chairs stuck to the ceiling, circles of chairs facing nothing, chairs stacked into the ceiling, desks fused into walls, dinner set for nobody, CRTs glowing at the wall, mannequins, stairs that climb into the ceiling. Somewhere, an old phone rings.

## Multiplayer

- The server runs the real level (AI, fear, abilities, catches) and streams it to everyone 30 times a second. Each player moves themselves and the server checks the move; a move that's too fast is snapped back.
- On the first level, AI wanderers fill the empty human slots, so there are always at least three prey and the monster can't be sure who's real. If a human player drops out mid-level, an AI takes over their body. If the monster drops out, the run ends.
- Humans have no map. They get first-person eyes, a stick of chalk and a flashlight with about 90 seconds of battery.
- On each level the monster wins if it harvests the fear quota before dawn; otherwise the humans win that level.

| Human controls | |
| --- | --- |
| `WASD` / mouse | Move and look |
| `Shift` | Sprint (uses stamina) |
| `C` | Crouch: slow, nearly silent, and holding still in the dark you hold your breath |
| `F` | Flashlight. Lets you see in a blackout, slows the monster to half speed and blocks its abilities while it's in the beam |
| `E` | Draw a chalk arrow at your feet, pointing the open way you face (12 for the whole run) |

Caught or escaped humans spectate the rest of the level on the full map; humans who were caught or left behind keep watching for the rest of the run.

### Touch controls

On a phone or tablet the game switches to on-screen controls (a touchscreen laptop switches on its first touch, and back on its next mouse click). Picking Play solo or Multiplayer goes fullscreen and landscape where the browser allows it.

- Left thumb: a stick appears wherever you put it down. Push it to the rim to sprint.
- Right thumb: drag to look. As the monster, a quick tap catches a wanderer in reach.
- Buttons: Crouch, Chalk and Light for humans; Take, Blackout, Shift, Seep, Erase, Redraw and Map for the monster. On the map, press Blackout or Shift and then tap where to use it.
- ❚❚ at the top pauses.

## Installing

The built game is a progressive web app: browsers offer to install it (Chrome and Edge show an install button in the address bar; on a phone, use Add to Home Screen). Installed, it opens fullscreen and in landscape, and solo nights work offline once the game has been opened once online.

- `public/manifest.webmanifest` sets the app's id to `/forgecreativeco.hum-a-backroom-story`, so an install of HUM never takes the place of another web game installed from the same site.
- `public/sw.js` is the service worker. It only runs in built copies (`npm run build`), not in `npm run dev`. Its caches are named `forgecreativeco.hum.*`. The page always loads fresh when online, so a new deploy shows up on the next launch. Multiplayer always needs a connection.
- `npx tsx scripts/icons.ts` redraws the icons in `public/icons`.

## Hosting online

```bash
npm run build
npm start
```

`npm start` runs one Node process that serves the built game and the WebSocket on `PORT` (default 8787). Netlify and other static hosts can't run it; use a host with long-running Node processes such as Render, Fly.io or Railway. Point it at `npm install && npm run build` to build and `npm start` to run. `render.yaml` sets this up on Render (New → Blueprint).

To keep the game itself on Netlify, set the Netlify build's environment variable `VITE_SERVER_URL` to the server's address (for example `https://hum-server.onrender.com`) and redeploy. Without it, the Netlify copy plays solo only. Render's free plan puts the server to sleep when idle, so the first visit after a while can take about a minute to connect; the menu shows "Waking the game server…" and keeps retrying for up to 100 seconds.

If players can't connect:

- Open `https://<your-server>/health` in a browser. It should say `ok`. If Render shows an error page instead, check the service's deploy logs on Render (a failed build leaves no live server).
- On Netlify, `VITE_SERVER_URL` is baked in at build time, so redeploy after setting or changing it. Without it, the Multiplayer menu says no server is set up.
- The server pings every connection every 20 seconds so hosting proxies don't drop players who are waiting in a menu.

## Checks

- `npm run sim` runs 20 headless solo nights with an idle monster and prints escape times (add `-- --chase` for a bot that chases, and `-- --level level1` to play another level, by its id in `src/levels.ts`). Use it when tuning `src/config.ts`.
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
