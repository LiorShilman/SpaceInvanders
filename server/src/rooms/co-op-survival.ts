import { Room, Client } from "colyseus";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";

/**
 * PROOF-OF-CONCEPT SLICE — not the full server-authoritative simulation
 * server/README.md describes. What this room actually does today:
 *
 * 1. Relays each connected client's OWN ship position/rotation to every
 *    other client (still simulated entirely client-side) — the original
 *    slice.
 * 2. NEW: owns the one piece of shared world state needed for players to
 *    actually feel like they're fighting the SAME enemies — the grid
 *    formation's position (sway + advance, ticked server-side) and a
 *    40-entry alive/dead array. A client that lands a hit sends
 *    "hitEnemy" instead of killing it locally; every client (including
 *    the shooter) applies the death only once it sees this state change
 *    — see Scene.tsx's own coop sync block for the client half of this.
 *
 * Still explicitly NOT here: per-enemy health/Heavy status (the shared
 * array is booleans only — every hit is treated as lethal in co-op,
 * unlike single-player's Heavy 2-hit rule), boss/wave-variant sync (a
 * wave clearing just resets to a fresh all-alive wave, no boss ever
 * spawns from this room's own state), no server-side hit validation
 * (a client can report hitting any index it wants), and no formation
 * SHAPE/Heavy-placement sync (see FORMATION/ENEMY_COUNT below — each
 * client still independently rolls its own layout/Heavy RNG on a shared
 * wave number, so two players' screens can show different-looking
 * formations even while agreeing on which of the 40 slots are alive).
 */

// Mirrors client/src/config/constants.ts's own FORMATION/ENEMY_COUNT
// values — duplicated here since shared/ (see its own README) doesn't
// exist yet. Keeping these two definitions in sync by hand is a known,
// documented gap for this POC; a real shared/ package is the real fix.
const ENEMY_COUNT = 40;
const FORMATION = {
  startZ: -32,
  frontLineZ: -8,
  swaySpeed: 0.6,
  swayAmplitude: 3.5,
  advanceSpeed: 0.4,
};

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 5.2;
  @type("number") z = 8;
  @type("number") rotZ = 0;
  @type("string") name = "";
}

export class CoOpState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("number") formationX = 0;
  @type("number") formationZ = FORMATION.startZ;
  @type("number") wave = 1;
  @type(["boolean"]) enemiesAlive = new ArraySchema<boolean>();
}

export class CoOpSurvivalRoom extends Room<CoOpState> {
  // Matches the docs/GAME_PLAN.md summary's own "2-4 players" target.
  maxClients = 4;
  // Server's own clock for the formation tick — independent of any one
  // client's simTime, and reset to 0 whenever a wave clears (see
  // hitEnemy below) so the new wave's formation restarts at FORMATION.startZ
  // exactly like a fresh single-player spawnWave call does.
  private simTime = 0;

  onCreate() {
    this.setState(new CoOpState());
    for (let i = 0; i < ENEMY_COUNT; i++) this.state.enemiesAlive.push(true);

    // A client sends this on its own throttled interval (see
    // client/src/net/coop.ts) — never at full 60fps, both to keep
    // bandwidth sane and because this slice has no interpolation on the
    // receiving end yet, so an update rate much higher than what a
    // receiver actually renders at would be wasted.
    this.onMessage("move", (client, data: { x: number; y: number; z: number; rotZ: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // No validation at all — see the class-level comment. A malicious
      // or buggy client can report anything; that's explicitly out of
      // scope for this slice.
      player.x = data.x;
      player.y = data.y;
      player.z = data.z;
      player.rotZ = data.rotZ;
    });

    // A client reports the INDEX it locally detected a hit on — no
    // position/timing check at all (see class comment: real hit
    // validation is future anti-cheat work this slice doesn't attempt).
    // Every hit is unconditionally lethal; there's no per-enemy health to
    // decrement.
    this.onMessage("hitEnemy", (_client, data: { index: number }) => {
      const i = data.index;
      if (!Number.isInteger(i) || i < 0 || i >= ENEMY_COUNT) return;
      if (!this.state.enemiesAlive[i]) return; // already dead — ignore a duplicate/late report
      this.state.enemiesAlive[i] = false;

      let anyAlive = false;
      for (let e = 0; e < ENEMY_COUNT; e++) {
        if (this.state.enemiesAlive[e]) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive) {
        for (let e = 0; e < ENEMY_COUNT; e++) this.state.enemiesAlive[e] = true;
        this.state.wave += 1;
        this.simTime = 0;
        this.state.formationZ = FORMATION.startZ;
        this.state.formationX = 0;
      }
    });

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), 1000 / 20);
  }

  private tick(deltaMs: number) {
    this.simTime += deltaMs / 1000;
    this.state.formationX = Math.sin(this.simTime * FORMATION.swaySpeed) * FORMATION.swayAmplitude;
    this.state.formationZ = Math.min(FORMATION.startZ + this.simTime * FORMATION.advanceSpeed, FORMATION.frontLineZ);
  }

  onJoin(client: Client) {
    const player = new Player();
    // Short and disposable — nothing yet reads this for anything but a
    // debug label; real identity/accounts are a later concern.
    player.name = `שחקן-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
