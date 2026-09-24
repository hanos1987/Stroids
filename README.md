# STROIDS

A vertical-scrolling space shooter with a 16-bit (SNES-era) look. Plain HTML5 canvas, no dependencies, no build step.

## Play

Open `index.html` in a browser. (You can also serve the folder with any static server, e.g. `python3 -m http.server`.)

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | Arrows / WASD | Stick / D-pad | Drag anywhere (relative, so your finger doesn't cover the ship) |
| Fire | **Automatic** | Automatic | Automatic |
| Focus (slow + tight shots) | Shift / Z | LB / RB / X | – |
| Bomb | X / Space | A / B | BOMB button |
| Pause | P / Esc / Enter | Start | II (top-right) |
| Mute | M | – | – |

## What's in it

- **3 stages + 3 bosses.** Outer Rim → Warden, Stroid Belt → Stroid Titan, Hive Core → Hive Queen. After stage 3 the game loops, and gets harder each loop.
- **Enemies:** drones, swoopers, gunships and cruisers, plus asteroids that break into smaller pieces.
- **Weapons:** colored orbs cycle through red, blue and green. Grab one to switch weapons or power up (5 levels).
  - **V**ulcan (red): wide spread. Focus tightens it into a narrow stream.
  - **L**aser (blue): a piercing beam that goes through enemies.
  - **H**oming (green): twin shots plus seeking missiles.
- **Other power-ups:** **O** option drones (up to 2) that trail behind and fire with you, **S** shield (absorbs one hit), **B** extra bomb, **1** extra life, gold gems for score.
- **Gold flashing enemies** always drop a weapon orb.

## Design notes (from shmup research)

- **Tiny, visible hitbox.** Only the white dot in the middle of the ship can be hit. It's always shown, and a ring appears around it while you focus. The dodging feels fair because players only need to watch the small area around that dot.
- **Bright bullets, dark background.** Enemy bullets are white-cored and outlined, and they're drawn on top of everything. Backgrounds are dim and dithered.
- **Few buttons.** Fire is automatic, so you only move, focus and bomb.
- **Forgiving deaths.** Dying costs one power level and one option, not everything. You also drop an orb to grab back and respawn with at least 2 bombs.
- **Steady upgrades.** Carriers show up regularly, and there's a guaranteed drop every 30 kills.
- **Fair enemy fire.** Enemies don't shoot from right on top of you. When a boss changes phase, it pauses briefly.
- **Game feel:** a fixed 60 Hz update, screen shake, hit flashes, dithered fireball explosions and chiptune sound effects and music.

## SNES-style graphics

- 224×288 internal resolution, scaled up with crisp pixels
- Hand-authored 16-color sprites with **palette swaps** for enemy variants, like the real hardware did
- Procedural sprites (bosses, asteroids, planets, explosions) shaded with a **4×4 Bayer dither** and an auto dark outline
- Dithered gradient skies (HDMA-style), parallax starfields, nebula layers
- All audio is synthesized with WebAudio: square, triangle and noise channels

## Files

- `js/gfx.js`: pixel-art sprite builder, palettes, pixel font, procedural bosses and explosions
- `js/audio.js`: SFX and music sequencer
- `js/game.js`: input, player, weapons, enemies, waves, bosses, HUD and main loop
