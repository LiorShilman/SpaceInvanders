import { Client, Room, getStateCallbacks } from "colyseus.js";

// PROOF-OF-CONCEPT slice (see server/src/rooms/co-op-survival.ts's own
// comment for the exact scope): each client still simulates its own game
// entirely client-side, exactly like single-player — this module only
// relays this ship's own position/rotation to the room, and mirrors back
// every OTHER connected player's last-known position/rotation so Scene.tsx
// can render a RemoteShip for each. There is no shared enemy/wave/boss
// state, no server-side hit detection, and no reconciliation — that's the
// real Phase 1 work this slice exists to validate the plumbing for.

export interface RemotePlayer {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  name: string;
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
