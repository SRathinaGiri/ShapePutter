# 🎯 3D Shape Putter PWA (stereoscopic 3D)

Flick your **white shape** into the **matching hole** in the middle of the board, past dark holes and coloured pucks that glide around. A circle first, then a square, a triangle, a diamond and stars with one more point every level. Fewer shots score more.

Version 2 is a full 3D rebuild of the original 2D canvas game. The gameplay, shapes, sizes and scoring are the 2D game's; the 3D engine, stereo modes, controls, VR, phone controller and PWA shell come from its sister project [3D Labyrinth](https://github.com/SRathinaGiri/3DLabyrinth).

## Features
- **3D board**: a framed table with real pits cut into the floor, a goal cup in the level's shape and extruded shape pucks. Moving holes are cut with the stencil buffer, so they are real pits that glide in every view and stereo mode.
- **3D modes**: 2D, Parallel SBS, Cross-Eye SBS, Anaglyph (red/cyan), Smart-Glasses HSBS (RayNeo / XREAL / Rokid / TCL) and WebXR VR (Meta Quest).
- **Cameras** (🎥 / <kbd>V</kbd>): **Overview** (angled, whole board), **Top-down** (closest to the 2D game) and **⛳ Behind the puck** (golf-style, aim is camera-relative, with a north-up board map: 🗺 / <kbd>N</kbd> = off / small / large).
- **Controls**: slingshot drag (touch or mouse), keyboard, gamepad, Quest controllers, optional phone **tilt aim**, and a second phone as a **📲 controller** for TVs and smart glasses.
- **In-scene HUD and 3D dialogs** on the zero-parallax plane, so level clear, game over and pause panels work in SBS, anaglyph, glasses and VR. Tap a button in either eye's half, or use ←/→ + Enter, a stick + A, or the Quest thumbstick + trigger.
- **Board & puck** choices that change the look *and* the physics.
- **Offline PWA**: three.js r128 is bundled and sound is synthesised with Web Audio, so **gameplay makes no external requests**. The one exception is pairing the optional phone controller (see below).

## How to play
| Input | Aim | Shoot |
|---|---|---|
| Touch / mouse | Press anywhere on the board and **pull back** like a slingshot; the puck goes the other way, further = harder | Release |
| Keyboard | <kbd>←</kbd><kbd>→</kbd> turn, <kbd>↑</kbd><kbd>↓</kbd> power | <kbd>Space</kbd> / <kbd>Enter</kbd> |
| Gamepad / Quest | Stick points the way, stick length = power | A / trigger |
| Tilt aim (phone, opt-in) | Tilt the phone towards the shot | Tap the screen |
| Phone controller | Tilt the phone (or drag in the circle) | OK |

The puck can only be shot once it has stopped (it glows). Letting a stick spring back keeps the aim. <kbd>P</kbd> pause · <kbd>G</kbd> aim guide · <kbd>C</kbd> re-level tilt · <kbd>M</kbd> mute.

## Rules (from the 2D game)
- **Scoring**: sinking the puck scores 5,000 on the 1st shot, 4,000 on the 2nd … 1,000 on the 5th, 0 after that.
- **Pucks** (lives): start with **5**; a **bonus puck** on reaching every 5th level (5, 10, 15 …).
- **Dark holes** cost a puck; the puck reappears somewhere safe. One hole per level (from level 2) moves.
- **Coloured pucks**: every hit costs **500 points**; every **10th hit** in a level also costs a puck. They hit you even while you are aiming.
- **Obstacles**: from level 2, 2 static holes + 1 moving hole + 3 moving pucks, and 2 more holes and 2 more pucks every 5 levels.
- **Game over** when you lose a puck with none left.

### What's new in 3D
- **🚩 Checkpoints**: Game Over sends you back to the last checkpoint level (1, 6, 11 …) with the score you had there and 5 fresh pucks, instead of all the way to level 1. The high score is kept.
- **Levels grid & stars**: ★★★ = hole in one, ★★ = two or three shots, ★ = cleared. Tap any level you have reached to **practise** it: stars count, the run's score and pucks are untouched.
- **Fixed boards**: each level number is a seed, so "Level 7" is the same board for everyone, every time.
- **Lip-outs**: a puck crossing a hole very fast skims over it (goal above 8 units/s, other holes above 11). The 2D game's frame-by-frame check let fast pucks jump holes too; this makes it consistent.
- **Fair moving obstacles**: moving holes never drift onto the goal or under a puck that is waiting to be shot, and coloured pucks skate round the pits instead of floating over them. After a hit they drift back to their cruise speed, so one hard shot can't send one flying for ever.
- **🎯 Aim guide** (optional, <kbd>G</kbd>, also on the pause panel and the phone): a dotted path with cushion bounces and an end marker (green = goal, red = hole). Moving pucks are not predicted. Using it caps the level at ★★.
- Leaving mid-level keeps that level's shots and hits, so quitting can't reset a bad shot. Restart is offered in practice only.

## Boards & pucks (`js/config.js` → `BOARD_SURFACES`, `PUCK_TYPES`)
| Board | Grip | Cushion | Feel |
|---|---|---|---|
| 🟩 Felt | 1.0× | 1.0× | Green baize, the original 2D look (friction = the 2D game's 0.99 per frame) |
| 🪵 Carrom | 0.7× | 0.85× | Polished, powdered carrom board: quick, soft cushions |
| 🧊 Glass | 0.4× | 1.1× | Slippery; the pits glow through the floor |
| 💠 Neon | 1.15× | 1.05× | Arcade board, colour changes every 5 levels |

| Puck | Grip | Cushion | Mass | Feel |
|---|---|---|---|---|
| ⚪ Plastic | 1.0× | 1.0× | 1.0× | All-rounder |
| ⚙️ Steel | 0.75× | 0.6× | 2.2× | Ploughs through the coloured pucks, dead cushions |
| 🔴 Rubber | 1.35× | 1.3× | 0.8× | Grippy and springy |

Collisions exchange momentum by mass (as in 2D, where mass = size), so a steel puck is barely deflected by a disc while a rubber one bounces off it.

## VR (Meta Quest)
Tap **🥽 VR** in the Quest browser. The board sits on a virtual table ~55 cm below your eyes with the far edge raised like a drafting table (or **🟫 Floor**: a giant board at your feet). The thumbstick aims, the trigger or A shoots, B / Y pauses (Resume · Guide · 🎯 Recenter · Table/Floor · ⏏ Exit VR). The Behind camera isn't offered in VR (moving the world around a player who stands still causes motion sickness).

## Smart glasses (RayNeo Air, XREAL, Rokid, TCL)
Pick **3D Viewing → Smart Glasses (HSBS)** and switch the glasses to 3D SBS. Turn on **📱 Tilt aim** and use the phone in your hand: tilt towards the shot, tap to shoot. A Bluetooth gamepad works too.

## 📲 Phone as controller (TV, Google TV + glasses)
1. In the game: **Controls → 📲 Phone controller**. It shows a 6-digit code and the controller address (`…/controller.html`).
2. On a phone on the **same Wi-Fi**, open that address, enter the code, tap **Connect**.
3. Tilt the phone (or drag in the circle) to aim, **OK** to shoot; ◀ ▶ / OK drive the 3D panels, ⏸ pauses, 🎯 Re-level sets "no aim".

How it works (`js/link.js`, ported unchanged from 3D Labyrinth): the two browsers are introduced once through the free public **PeerJS signalling server** (`0.peerjs.com`) using the official **PeerJS client 1.5.5** (MIT, bundled as `js/lib/peerjs.min.js`, provenance in `js/lib/peerjs.LICENSE.txt`). After that a WebRTC data channel carries the aim (~30/s) and button presses **directly between the devices**. TURN relays are switched off (STUN only), so game data never passes through a third party; Google's public STUN server only helps the devices find a route. Use of both was approved for this game on 2026-10-23, and `tests/version.test.mjs` fails if any other outside host appears in the code. Only whitelisted button actions are accepted, and if aim messages stop for 0.5 s the aim stops following. The 6-digit code is convenience pairing, not strong authentication.

## Run locally
ES modules need a web server:
```bash
python -m http.server 8087
```
Then open http://localhost:8087. Tilt aim needs **HTTPS** on real phones; GitHub Pages provides that.

## Releasing
Bump the version in **all** of: `js/config.js` (`VERSION`), `sw.js` (`CACHE_VERSION`), `manifest.json`, `index.html` and `controller.html` (badge + every `?v=`, import maps included). `tests/version.test.mjs` fails if any of them disagree. The service worker pre-caches from the network and only deletes caches named `shapeputter-*` (plus the 2D game's old `shape-putter-v1`), so other games on the same `github.io` origin keep their offline copies.

## Tests
```bash
node --test tests/logic.test.mjs tests/version.test.mjs tests/solvable.test.mjs
```
- `logic.test.mjs`: the 2D shape table and sizes, deterministic levels, clean obstacle placement, safe spawns, 2D-matching friction, no escaping the board or tunnelling through discs at full power, momentum conservation, mass effects, goal / hole capture and lip-outs, moving-hole and disc fairness, one penalty per contact, aim-guide accuracy, scoring, bonus pucks, checkpoints, disc-hit penalties, and progress merging (a stale second copy of the game can't roll back bests).
- `version.test.mjs`: release versions, import maps, service-worker caching, installable icons and the outside-host whitelist.
- `solvable.test.mjs`: a look-ahead autopilot clears levels 1–30 with the real physics, moving pucks included, without falling in a hole, and levels 1–10 on the extreme board/puck pairings (~1 min).

## Structure
```
js/config.js    constants, rules, board/puck tables (pure)
js/levels.js    seeded level generator, shapes, safe spawns (pure)
js/physics.js   puck, discs, holes, goal, aim-guide prediction (pure)
js/rules.js     scoring, pucks, checkpoints (pure)
js/progress.js  saved run + bests, merged across tabs (pure)
js/renderer.js  stereo engine (from 3D Labyrinth / Tunnel Rush)
js/board.js     three.js scene for a level (stencil-cut moving holes)
js/materials.js procedural felt / carrom / glass / neon, pucks, reflections
js/controls.js  drag / keys / gamepad / XR / gyro / phone input
js/hud3d.js     in-scene HUD, 3D dialogs, board map
js/audio.js     Web Audio synth
js/ui.js        menus, settings
js/link.js      phone-controller pairing; js/pad.js = controller.html
js/app.js       game loop, aiming, cameras, level lifecycle, WebXR, service worker
```

### Developed by
* S. Rathinagiri (**SRathinagiri**)
* 2D version: **Coding Partner**, an AI assistant from Google. 3D version: built with Claude Code.

three.js (r128) and PeerJS (1.5.5) are MIT-licensed and bundled unmodified in `js/lib`.
