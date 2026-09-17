import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";

/**
 * PROOF-OF-CONCEPT SLICE — not the full server-authoritative simulation
 * server/README.md describes. What this room actually does today: each
 * connected client reports its OWN ship's position/rotation (still
 * simulated entirely client-side, exactly like single-player), and the
 * room just relays that to every other client in the same room so
 * everyone can see everyone else's ship move in real time. There is no
 * shared formation, no shared enemy/boss/wave state, no server-side hit
 * detection, and no anti-cheat — a client could report any position it
 * wants. This exists to validate the actual network plumbing (Colyseus
 * room lifecycle, schema sync, client subscription) end-to-end before
 * investing in porting Scene.tsx's whole simulation to run server-side,
 * which is the next real step once this slice is confirmed working.
 */
export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 5.2;
  @type("number") z = 8;
  @type("number") rotZ = 0;
  @type("string") name = "";
}

export class CoOpState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class CoOpSurvivalRoom extends Room<CoOpState> {
  // Matches the docs/GAME_PLAN.md summary's own "2-4 players" target.
  maxClients = 4;

  onCreate() {
    this.setState(new CoOpState());

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
