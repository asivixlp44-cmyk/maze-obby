# Maze Obby

A multiplayer maze obby for the browser, built with **Three.js** and **Colyseus** for Bloxity. Run through twelve giant themed mazes in a row, floating in the sky, from golden sand walls over clear blue water to a neon maze under the stars. It clones the Roblox game *[Maze Obby](https://www.roblox.com/games/138866272793084/Maze-Obby)* (see `reference/Gameplay.mp4`).

**There are no in-app purchases.** Gear, Fling All, Kill All, skips and trails are all bought with **Wins**, earned by clearing mazes.

It shares its engine with the other Legion games (server, Bloxity login and avatars, profiles, saves; built from Strawberry Tower). The mazes, the lobby, the HUD, the morphs, the gear and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player, physics, gear, the Ray Gun and the Deadly Sword, morphs, network, camera, the loading warm-up), `world.js` (the lobby, the mazes, the plazas, the finish), `materials.js` (the twelve maze themes and every other texture, all drawn in code), `morphs.js` (the Free Morphs), `engine.js` (renderer, sky and moods, lights, studs, text), `fx.js` (quality presets, one-draw-call particles, trails, rings, fireworks), `gear.js`, `audio.js` (music and sounds), `ui.js` + `index.html` (HUD and panels) |
| `server/` | Colyseus 0.18 server: the `maze` room (`MazeRoom.js`), profiles, leaderboards, play stats |
| `shared/` | `config.js` (stages, Wins economy, gear, morphs, trails, lucky block, rewards) and `maze.js` (the layout and the maze generator, used by both sides) |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2613
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5193 (the client talks to the server on port 2613; `VITE_SERVER_URL` overrides that). Dev builds (or a build with `VITE_QA=1`) expose `window.__qa` for automated test runs.

## Gameplay (from the reference)

- **The lobby** is a floating checkered platform with a glass fence, like the reference:
  - the magenta star spawn pad and big red arrows on the floor pointing to the first maze
  - **Free Morphs**: nine statues on a striped stand (Classic Noob, Blue Buddy, Banana, Robo, Knight, Ninja, Zombie, Princess, Dino); step up to one to become it, and the red pad removes it
  - the **treasure chest**: free Wins every 30 minutes
  - the **Wins Leaderboard** and **Most Escapes** boards with a big gold trophy
  - **GAMEPASS**: the gear on coloured pads along a dark runway
  - the giant **lucky block**, the **TRAILS** rack and the **INVITE FRIENDS** rainbow pad
  - the "Complete the mazes to be a winner!" sign by the way in
- **The mazes**: twelve in a row, each bigger and harder than the last. Every maze is generated from a seed (the same for everyone, every time) and picked so the way through gets longer every stage (12 cells in the first, 83 in the last). Only the first mazes have a few extra openings (loops); later a wrong turn means a long walk back. A beam of light over the exit shows the way in mazes 1 to 6 only. From maze 4 on, glowing red **kill bricks** lie across the way through: jump them (a running jump clears them easily), touch one and you're back at your checkpoint. The first nine follow the reference's look:

  | # | Maze | Size | Way through | Kill bricks | Checkpoint pays |
  |---|---|---|---|---|---|
  | 1 | **Sandy Shores**: golden sand walls over clear blue water | 7 x 6 | 12 cells | 0 | 3 Wins |
  | 2 | **Hedge Garden**: leafy hedges on asphalt | 7 x 7 | 19 | 0 | 4 |
  | 3 | **Yellow Bricks** on red dirt | 9 x 7 | 25 | 0 | 6 |
  | 4 | **Rainbow Blocks**: every wall a different colour, purple floor | 9 x 8 | 32 | 1 | 8 |
  | 5 | **Grass Labyrinth** | 9 x 9 | 37 | 2 | 10 |
  | 6 | **Dark Hedges** on wooden boards | 11 x 9 | 45 | 3 | 13 |
  | 7 | **Stud City**: grey studs on green (no more exit beams) | 11 x 10 | 52 | 4 | 16 |
  | 8 | **The Backrooms**: yellow wallpaper, brown carpet | 11 x 11 | 57 | 4 | 20 |
  | 9 | **Frozen Caves**: cracked ice walls, a slippery floor | 13 x 11 | 65 | 5 | 25 |
  | 10 | **Lava Castle**: obsidian walls glowing with lava, a red sky | 13 x 12 | 70 | 7 | 30 |
  | 11 | **Candy Land**: candy cane walls on chocolate | 15 x 12 | 78 | 8 | 36 |
  | 12 | **Neon Galaxy**: glowing lines under a starry night | 15 x 13 | 83 | 9 | +150 at the finish |

  Mazes 10 to 12 and the kill bricks are new (the video only shows nine plain mazes). Each maze has its own sky, light and floating particles (sand glints, leaves, snow, embers, sparkles).
- **Between two mazes**: a checkpoint plaza with the yellow pad and red arrow, a waving flag, the next maze's STAGE sign, some gear pads and a cheer ("You're unstoppable!"). The whole plaza counts as the checkpoint.
- **Wins**: each new checkpoint of a run pays its maze's Wins, gems hidden in dead ends +1, the finish +150 (a run must take at least 60 s and touch every checkpoint). **Rewards restart once you finish**: the run starts again from the lobby. A run that skipped ahead pays a quarter at the finish. Wins are multiplied by x2 Wins, the x2 boost and Friend Boost (+10% per Bloxity friend in the server, up to +50%).
- **No wall walking**: anyone who ends up on top of a maze wall drops into the nearest corridor.
- **The reference's buttons**:
  - **Fling All** (250, 30 s recharge): everyone else is thrown into the air.
  - **Kill All** (350, 1 minute recharge): everyone else goes back to their checkpoint.
  - **Skip Stage** (15 and up), **Skip to End** (600, cheaper the further you are).
  - The lucky block **?**: a free spin every 10 minutes (Wins or a x2 boost).
  - **2x**: x2 Wins forever (4K).
  - **Trails** (40 to 12K), **Daily Rewards** (7 days, a trail on day 7), **playtime gifts** and **codes** (`MAZE`, `OBBY`, `WINNER`, `LEGION`, `RELEASE`).
- **Gear**: Speed Coil (75), Gravity Coil (150, floaty jumps, still under the walls), Ray Gun (400, zap and fling players), Super Coil (800), Deadly Sword (1.5K, one hit sends a player back to their checkpoint), Magic Carpet (8K, fly over the walls).
- **HUD**: the "Stage X/12 (Y%)" bar with the lucky block, Fling All / Wins / Trails under it, Skip to End / Kill All / Skip Stage on the left, the gear buttons and 2x on the right, Shop / Daily / Gifts / Teleport / Invite / Settings top right. The top-left corner is kept free for the Bloxity overlay.

## Sound

- **Music**, "Maze Runner": an original code-generated 118 BPM adventure-pop loop in G major (electric piano, bouncy bass, kick and claps, shaker, a marimba-bell hook).
- **Footsteps** per maze, all synthesized: splashy water, asphalt, crunchy dirt, plastic, rustling grass, hollow wood, Roblox studs, a muffled carpet, crunchy ice, hard obsidian, candy, buzzing neon. Separate Music / Footsteps / Effects volumes in Settings.

## Graphics and performance

- The reference's look, richer: every theme drawn in code (straw-like sand, leafy hedges, bevelled bricks, damask wallpaper, cracked ice, glowing lava mortar, neon grids), snow on the ice walls, icing on the candy walls, glowing lines on the lava and neon walls, rippling water, floating rock under every platform, a sea of clouds below, a sky that changes with each maze.
- **Built for weak PCs**: only matte (Lambert) and unlit materials, no reflections, no environment map, no post-processing (the vignette is CSS). Each maze's walls are merged straight runs and every static prop is merged into its zone's batches (a few draw calls per maze); only the maze you're in and its neighbours are drawn; static objects have frozen matrices; the clouds are one draw call; gems are one instanced mesh that spins in the vertex shader (no buffer uploads per frame); every particle is in one of two point clouds.
- **No stutter**: the world is built in slices while the server join runs in parallel; every shader (including the shadow pass's) is compiled in the background and every texture uploaded before you spawn. The shader count stays at 37 for a whole session (all gear, a morph, every maze checked).
- **Quality**: Low (no shadows, no particles or vignette, the HUD's shine animations paused, 0.8 resolution), Medium (default on desktop) and High; phones start on Low. Changing quality never recompiles a shader (Low stops drawing the shadow map instead of switching shadows off), so a slow PC that steps down automatically doesn't freeze when it does; that step is never saved.
- Measured on this PC (headless Chrome, real GPU, vsync): 1080p on Medium and High holds the 144 Hz refresh rate with no frame over 33 ms; with the CPU slowed down 4x it still runs about 58 FPS on Low and 43 on Medium.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Jump / fly up | Space | A | JUMP |
| Fly down (carpet) | Shift / Q / C | LT/RT | ⬇ |
| Zap / swing / interact | Click or E | X | 🔫 / 🗡️ button |
| Gear | 1-6 | LB / RB | Hotbar |
| Camera | Drag, wheel to zoom | Right stick, D-pad | Drag |

## Multiplayer and saves

- One shared `maze` room (up to 24 players). Movement is client-side; Wins, checkpoints, gems, the finish, the chest and the lucky block (all checked by the server), gear, morphs, trails, Ray Gun zaps and sword hits (range and cooldown), Fling All and Kill All (cooldowns) and purchases are decided by the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/maze-obby-server`, Legion rollout, client upload. Play at https://maze-obby.play.bloxity.io once the app `maze-obby` exists on hosting.bloxity.io and the repo has the `LEGION_DEPLOY_TOKEN` secret. `bloxity-setup.html` has every field of the Create New Game form with copy buttons (no IAPs).
