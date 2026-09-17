import { Client, Room, getStateCallbacks } from "colyseus.js";

// PROOF-OF-CONCEPT slice (see server/src/rooms/co-op-survival.ts's own
// comment for the exact scope): each client still simulates its own game
// entirely client-side, exactly like single-player, EXCEPT for the one
// piece of state this module now also exposes — the shared grid
// formation's position and its 40-entry alive/dead array, both owned and
// ticked by the server. Ship positions are still purely relayed (each
// client is authoritative over its own), and everything else (boss,
// Heavy/health, dive/flank, pickups, score) stays entirely local and
// unsynced — see Scene.tsx's own coop sync block for exactly how the
// shared formation/kill state gets applied.

export interface RemotePlayer {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  name: string;
}

export interface SharedFormation {
  x: number;
  z: number;
  wave: number;
}

// How often this client reports its own position — far below the 60fps
// simulation rate on purpose (see the room's own comment): this slice has
// no interpolation on the receiving end yet, so a much higher rate would
// just be wasted bandwidth for a jump every packet either way.
const SEND_HZ = 15;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

let client: Client | null = null;
let room: Room | null = null;
let lastSendAt = 0;
// A plain mutable map, not React state — Scene.tsx's own render loop reads
// this every frame exactly like every other per-frame ref in that file,
// not through a re-rendering subscription (the whole point of that
// codebase's convention: a 60fps loop should never be gated behind React's
// own render cycle). onStateChange below is the only place that mutates it.
const remotePlayers = new Map<string, RemotePlayer>();

export function getRemotePlayers(): ReadonlyMap<string, RemotePlayer> {
  return remotePlayers;
}

export function getOwnSessionId(): string | null {
  return room?.sessionId ?? null;
}

export function isCoOpConnected(): boolean {
  return room !== null;
}

/** Reads the room's current formation position + wave directly off the
 * synced schema — a plain poll, not an event subscription, since
 * Scene.tsx's own per-frame loop already calls this every frame anyway
 * (same reasoning reportOwnPosition below needs no callback machinery of
 * its own). No shared/ package yet (see its own README), hence the `as`
 * cast instead of a real generated type. */
export function getSharedFormation(): SharedFormation | null {
  if (!room) return null;
  const s = room.state as unknown as { formationX?: number; formationZ?: number; wave?: number };
  // Same brief "not synced yet" window as getSharedEnemiesAlive below —
  // `wave` in particular being momentarily undefined here once caused a
  // real crash downstream: Scene.tsx compares it against coopKnownWave
  // and, on a mismatch, calls spawnWave(formation, wave), which indexes
  // WAVE_SHAPES with (wave - 1) — NaN from an undefined wave produced an
  // out-of-bounds `undefined`, then a "shape is not a function" TypeError
  // several calls deep. Guard here instead of trusting every caller downstream
  // to check each field individually.
  if (s.formationX === undefined || s.formationZ === undefined || s.wave === undefined) return null;
  return { x: s.formationX, z: s.formationZ, wave: s.wave };
}

/** A fresh plain array snapshot each call — cheap at 40 booleans, and
 * simpler than wiring ArraySchema's own change callbacks for a value
 * Scene.tsx already diffs itself frame-to-frame (see
 * coopEnemiesAliveMirror in Scene.tsx). */
export function getSharedEnemiesAlive(): boolean[] | null {
  if (!room) return null;
  const s = room.state as unknown as { enemiesAlive: boolean[] | undefined };
  // room.state itself exists the instant joinOrCreate resolves, but the
  // very first full-state patch (this array included) can arrive a beat
  // later — reading it in that brief window would otherwise throw
  // (Array.from(undefined)) instead of just "no shared kill state yet."
  if (!s.enemiesAlive) return null;
  return Array.from(s.enemiesAlive);
}

/** Reports that THIS client's own local hit-test detected a hit on grid
 * slot `index` — see the room's own hitEnemy handler for what happens
 * next. Fire-and-forget: the actual "this enemy is now dead" truth only
 * ever arrives back via getSharedEnemiesAlive(), applied uniformly to
 * every client (including the shooter) by Scene.tsx's own sync block,
 * never assumed locally just because this was sent. */
export function reportEnemyHit(index: number) {
  room?.send("hitEnemy", { index });
}

/** Connects and joins the shared co-op room. Safe to call once; a second
 * call while already connected is a no-op rather than opening a duplicate
 * connection. */
export async function joinCoOp(serverUrl: string): Promise<void> {
  if (room) return;
  client = new Client(serverUrl);
  const joined = await client.joinOrCreate<{
    players: { x: number; y: number; z: number; rotZ: number; name: string };
  }>("co_op_survival");
  room = joined;

  // Colyseus 0.15+'s callback API: schema instances/collections no longer
  // expose onAdd/onRemove/onChange directly (that changed in a breaking
  // release — see colyseus.js's own migration notes) — every callback now
  // goes through this proxy instead. $(room.state).players mirrors a
  // MapSchema's own add/remove events; $(player) mirrors one Player
  // instance's own field changes.
  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((player, sessionId) => {
    if (sessionId === room?.sessionId) return; // never render our own ship as a remote one
    const sync = () => {
      remotePlayers.set(sessionId, { x: player.x, y: player.y, z: player.z, rotZ: player.rotZ, name: player.name });
    };
    sync();
    $(player).onChange(sync);
  });
  $(room.state).players.onRemove((_player, sessionId) => {
    remotePlayers.delete(sessionId);
  });

  room.onLeave(() => {
    remotePlayers.clear();
    room = null;
    client = null;
  });
}

export function leaveCoOp() {
  room?.leave();
  room = null;
  client = null;
  remotePlayers.clear();
}

/** Called from Scene.tsx's own per-frame loop — throttles itself
 * internally (see SEND_HZ) so the caller doesn't need its own timer. */
export function reportOwnPosition(x: number, y: number, z: number, rotZ: number) {
  if (!room) return;
  const now = Date.now();
  if (now - lastSendAt < SEND_INTERVAL_MS) return;
  lastSendAt = now;
  room.send("move", { x, y, z, rotZ });
}
