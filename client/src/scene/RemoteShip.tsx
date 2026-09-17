import { forwardRef } from "react";
import * as THREE from "three";
import { COLORS } from "../config/constants";
import { Ship } from "./Ship";

/**
 * A teammate's ship in the Co-op proof-of-concept (see net/coop.ts) — the
 * exact same model as the player's own Ship.tsx, just retinted gold so the
 * two are never confused, with no weapon-accent retinting logic attached
 * (that lives in Scene.tsx's setShipAccentColor, which only ever touches
 * the LOCAL ship — a remote player's current weapon isn't part of this
 * slice's synced state at all yet). Position is driven by Scene reading
 * net/coop.ts's own remotePlayers map every frame, same imperative-ref
 * convention as every other Scene-driven object.
 */
export const RemoteShip = forwardRef<THREE.Group>(function RemoteShip(_props, ref) {
  return (
    // Ship.tsx's own root group has no visibility prop of its own (the
    // local ship is always visible) — wrapped in one here instead, same
    // "hidden by default, Scene shows it imperatively" convention every
    // other pooled object (Grenade, Projectile, ...) already uses, so an
    // unused pool slot doesn't render a stray gold ship at the origin.
    <group ref={ref} visible={false}>
      <Ship accentColor={COLORS.allyAccent} accentColorDim={COLORS.allyAccentDim} />
    </group>
  );
});
