/**
 * The geometry and rules of a world's path: where the buddy stands for a number of Sparks, and
 * what each landmark looks like to the child. The backend owns the numbers; this only draws them.
 */
import type { JourneyWorld, Landmark } from "./api";

export interface Point { x: number; y: number }
export type LandmarkState = "found" | "ready" | "hidden";

/** Every path starts in the bottom-left corner of its scene. */
const START: Point = { x: 9, y: 86 };

export const landmarkKey = (world: JourneyWorld, mark: Landmark) => `${world.id}:${mark.id}`;

export function landmarkState(world: JourneyWorld, mark: Landmark, sparks: number, found: string[]): LandmarkState {
  if (found.includes(landmarkKey(world, mark))) return "found";
  return sparks >= mark.sparks ? "ready" : "hidden";
}

/** Landmarks the child has walked past but not yet opened, in path order. */
export function readyLandmarks(worlds: JourneyWorld[], sparks: number, found: string[]) {
  return worlds.flatMap((world) => world.landmarks
    .filter((mark) => landmarkState(world, mark, sparks, found) === "ready")
    .map((mark) => ({ world, mark })));
}

/** The stops along the path, with the Sparks at which the buddy reaches each. */
function stops(world: JourneyWorld): (Point & { sparks: number })[] {
  return [{ ...START, sparks: world.sparks }, ...world.landmarks.map(({ x, y, sparks }) => ({ x, y, sparks }))];
}

/** Where the buddy stands: between two stops for Sparks inside this world, at an end otherwise. */
export function positionAt(world: JourneyWorld, sparks: number): Point {
  const path = stops(world);
  const after = path.findIndex((stop) => stop.sparks > sparks);
  if (after === 0) return { x: path[0].x, y: path[0].y };
  if (after === -1) return { x: path[path.length - 1].x, y: path[path.length - 1].y };
  const from = path[after - 1];
  const to = path[after];
  const part = (sparks - from.sparks) / (to.sparks - from.sparks);
  return { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part };
}

const svgPoints = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

/** The whole trail, the part walked, and the part waiting for a grown-up, as SVG points. */
export function trail(world: JourneyWorld, sparks: number, pending: number) {
  const path = stops(world);
  const walked = [...path.filter((stop) => stop.sparks <= sparks), positionAt(world, sparks)];
  const waiting = [
    positionAt(world, sparks),
    ...path.filter((stop) => stop.sparks > sparks && stop.sparks < sparks + pending),
    positionAt(world, sparks + pending),
  ];
  return { all: svgPoints(path), walked: svgPoints(walked), waiting: svgPoints(waiting) };
}

/** Evenly spaced prints along the walked part of the trail. */
export function prints(world: JourneyWorld, sparks: number, gap = 3): Point[] {
  const out: Point[] = [];
  const end = Math.min(sparks, world.landmarks[world.landmarks.length - 1].sparks);
  for (let s = world.sparks + gap; s < end; s += gap) out.push(positionAt(world, s));
  return out;
}
