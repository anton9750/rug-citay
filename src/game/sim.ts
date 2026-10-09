/** Rug City driving sim. Pure so control signs can be checked without three.js. */

/**
 * The world is a (TILES x TILES) grid of the same rug tile. Every other tile is
 * mirrored, so a road that reaches a tile edge continues seamlessly into the
 * neighbouring tile (and the texture uses MirroredRepeatWrapping to match).
 */
export const TILE_W = 16;
export const GRID_W = 360;
export const GRID_H = 240;
export const TILE_H = (TILE_W * GRID_H) / GRID_W;
/** Tiles on each side of the centre tile. Keep it even so the centre tile is unmirrored. */
export const TILE_HALF = 2;
export const TILES = TILE_HALF * 2 + 1;
export const WORLD_W = TILE_W * TILES;
export const WORLD_H = TILE_H * TILES;

export const CELL_BLOCK = 0;
export const CELL_GRASS = 1;
export const CELL_ROAD = 2;

export type SimState = {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  distance: number;
  wheel: number;
  /** Visual front-wheel steer, -1..1. Positive = left. */
  face: number;
  shake: number;
  started: boolean;
  dragging: boolean;
  pointerX: number;
  pointerZ: number;
  steerOverride: number | null;
};

export type DriveInput = {
  throttle: number;
  steer: number;
  pointer: { x: number; z: number } | null;
};

export type Spawn = { x: number; z: number; yaw: number };

export function createSim(): SimState {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    distance: 0,
    wheel: 0,
    face: 0,
    shake: 0,
    started: false,
    dragging: false,
    pointerX: 0,
    pointerZ: 0,
    steerOverride: null,
  };
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Mask lookup in world space; the single tile mask is mirrored across tile borders. */
export function sample(mask: Uint8Array, x: number, z: number): number {
  const u = x / TILE_W + 0.5;
  const v = z / TILE_H + 0.5;
  const tu = Math.floor(u);
  const tv = Math.floor(v);
  if (Math.abs(tu) > TILE_HALF || Math.abs(tv) > TILE_HALF) return CELL_BLOCK;
  let fu = u - tu;
  let fv = v - tv;
  if (tu & 1) fu = 1 - fu;
  if (tv & 1) fv = 1 - fv;
  const gx = Math.min(GRID_W - 1, Math.floor(fu * GRID_W));
  const gz = Math.min(GRID_H - 1, Math.floor(fv * GRID_H));
  return mask[gz * GRID_W + gx] ?? CELL_BLOCK;
}

/** Centre of a cell inside the centre (unmirrored) tile. */
function cellCenter(gx: number, gz: number): { x: number; z: number } {
  return {
    x: ((gx + 0.5) / GRID_W) * TILE_W - TILE_W / 2,
    z: ((gz + 0.5) / GRID_H) * TILE_H - TILE_H / 2,
  };
}

/** Longest clear road ray, so the car starts pointed down a street. */
function roadRun(mask: Uint8Array, x: number, z: number, yaw: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let dist = 0;
  for (let i = 1; i <= 48; i++) {
    const s = sample(mask, x + fx * i * 0.1, z + fz * i * 0.1);
    if (s !== CELL_ROAD) break;
    dist = i * 0.1;
  }
  return dist;
}

export function findSpawn(mask: Uint8Array): Spawn {
  let bestScore = -Infinity;
  let best: Spawn = { x: 0, z: 0.4, yaw: 0 };

  for (let gz = 6; gz < GRID_H - 6; gz += 3) {
    for (let gx = 6; gx < GRID_W - 6; gx += 3) {
      if (mask[gz * GRID_W + gx] !== CELL_ROAD) continue;
      const { x, z } = cellCenter(gx, gz);
      let run = 0;
      let yaw = 0;
      for (let i = 0; i < 16; i++) {
        const candidate = (i / 16) * Math.PI * 2;
        const along = roadRun(mask, x, z, candidate);
        if (along > run) {
          run = along;
          yaw = candidate;
        }
      }
      if (run < 1.4) continue;
      const score = run - Math.abs(x) * 0.08 - Math.abs(z) * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, yaw };
      }
    }
  }
  return best;
}

function nearestRoad(
  mask: Uint8Array,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } | null {
  const cell = TILE_W / GRID_W;
  const steps = Math.ceil(radius / cell);
  const cx0 = Math.floor(x / cell);
  const cz0 = Math.floor(z / cell);
  let best: { x: number; z: number } | null = null;
  let bestD = radius * radius;
  for (let dz = -steps; dz <= steps; dz++) {
    for (let dx = -steps; dx <= steps; dx++) {
      const px = (cx0 + dx + 0.5) * cell;
      const pz = (cz0 + dz + 0.5) * cell;
      if (sample(mask, px, pz) !== CELL_ROAD) continue;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz };
      }
    }
  }
  return best;
}

/** Nose hits a building or the rug edge. Side kisses are allowed so lanes stay drivable. */
function noseBlocked(mask: Uint8Array, x: number, z: number, yaw: number): boolean {
  if (sample(mask, x, z) === CELL_BLOCK) return true;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (sample(mask, x + fx * 0.2, z + fz * 0.2) === CELL_BLOCK) return true;
  return false;
}

function accelerate(speed: number, throttle: number, dt: number): number {
  const accel = 5.4;
  const brake = 8;
  const coast = 2.6;
  const maxF = 2.45;
  const maxR = 1.2;
  let next = speed;
  if (throttle > 0.05) next += throttle * accel * dt;
  else if (throttle < -0.05) next += throttle * brake * dt;
  else next -= Math.sign(next) * Math.min(Math.abs(next), coast * dt);
  return Math.max(-maxR, Math.min(maxF, next));
}

function stepOnce(sim: SimState, mask: Uint8Array, input: DriveInput, dt: number) {
  let throttle = input.throttle;
  let steer = input.steer;
  const pointer = input.pointer;

  if (pointer && Math.abs(input.throttle) < 0.05 && Math.abs(input.steer) < 0.05) {
    const dx = pointer.x - sim.x;
    const dz = pointer.z - sim.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.035) {
      const desired = Math.atan2(-dx, -dz);
      const diff = wrapAngle(desired - sim.yaw);
      const maxStep = 5.2 * dt;
      const applied = Math.max(-maxStep, Math.min(maxStep, diff));
      sim.yaw = wrapAngle(sim.yaw + applied);
      sim.face += (Math.max(-1, Math.min(1, diff / 0.55)) - sim.face) * Math.min(1, 12 * dt);
      const want = dist < 0.1 ? 0 : Math.min(2.45, Math.max(0, (dist - 0.06) * 2.7));
      if (Math.abs(diff) < 1.05) {
        sim.speed += (want * Math.max(0, Math.cos(diff)) - sim.speed) * Math.min(1, 10 * dt);
      } else {
        sim.speed += (0 - sim.speed) * Math.min(1, 8 * dt);
      }
    } else {
      sim.speed += (0 - sim.speed) * Math.min(1, 14 * dt);
      sim.face += (0 - sim.face) * Math.min(1, 10 * dt);
    }
  } else {
    const turnRate = 2.7;
    const speedFactor = Math.min(1, Math.max(0.55, Math.abs(sim.speed) / 0.65));
    const reverse = sim.speed >= -0.04 ? 1 : -1;
    sim.yaw = wrapAngle(sim.yaw + steer * turnRate * speedFactor * reverse * dt);
    sim.speed = accelerate(sim.speed, throttle, dt);
    sim.face += (steer - sim.face) * Math.min(1, 10 * dt);
  }

  const here = sample(mask, sim.x, sim.z);
  if (here === CELL_GRASS) {
    const cap = 0.42;
    if (sim.speed > cap) sim.speed += (cap - sim.speed) * Math.min(1, 9 * dt);
    else if (sim.speed < -cap) sim.speed += (-cap - sim.speed) * Math.min(1, 9 * dt);
  }

  const fx = -Math.sin(sim.yaw);
  const fz = -Math.cos(sim.yaw);
  let nx = sim.x + fx * sim.speed * dt;
  let nz = sim.z + fz * sim.speed * dt;
  const hit = noseBlocked(mask, nx, nz, sim.yaw);
  if (hit) {
    const xOk = !noseBlocked(mask, nx, sim.z, sim.yaw);
    const zOk = !noseBlocked(mask, sim.x, nz, sim.yaw);
    if (xOk && !zOk) nz = sim.z;
    else if (zOk && !xOk) nx = sim.x;
    else if (xOk && zOk) {
      // Prefer the axis that stays on pavement.
      if (sample(mask, nx, sim.z) === CELL_ROAD) nz = sim.z;
      else nx = sim.x;
    } else {
      nx = sim.x;
      nz = sim.z;
      if (Math.abs(sim.speed) > 0.35) sim.shake = Math.min(1, sim.shake + 0.85);
      sim.speed *= 0.35;
    }
  }

  if (sample(mask, nx, nz) === CELL_GRASS) {
    const pull = nearestRoad(mask, nx, nz, 0.5);
    if (pull) {
      const mx = nx + (pull.x - nx) * Math.min(1, 4 * dt);
      const mz = nz + (pull.z - nz) * Math.min(1, 4 * dt);
      if (!noseBlocked(mask, mx, mz, sim.yaw)) {
        nx = mx;
        nz = mz;
      }
    }
  }

  const moved = Math.hypot(nx - sim.x, nz - sim.z);
  sim.distance += moved;
  sim.x = nx;
  sim.z = nz;
  sim.wheel += sim.speed * dt * 11;
  sim.shake *= Math.max(0, 1 - 3.5 * dt);
}

export function step(sim: SimState, mask: Uint8Array, input: DriveInput, dt: number) {
  let left = Math.min(Math.max(dt, 0), 0.1);
  while (left > 1e-5) {
    const h = Math.min(left, 1 / 60);
    stepOnce(sim, mask, input, h);
    left -= h;
  }
}

export function inputFromHeld(
  held: ReadonlySet<string>,
  steerOverride: number | null,
  pointer: { x: number; z: number } | null,
): DriveInput {
  let steer = 0;
  let throttle = 0;
  const left = held.has("KeyA") || held.has("ArrowLeft");
  const right = held.has("KeyD") || held.has("ArrowRight");
  const up = held.has("KeyW") || held.has("ArrowUp");
  const down = held.has("KeyS") || held.has("ArrowDown");
  if (left) steer += 1;
  if (right) steer -= 1;
  if (up) throttle += 1;
  if (down) throttle -= 1;
  if (steerOverride !== null) steer = Math.max(-1, Math.min(1, steerOverride));
  const keying = up || down || left || right || steerOverride !== null;
  return {
    throttle,
    steer,
    pointer: !keying && pointer ? pointer : null,
  };
}

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}
