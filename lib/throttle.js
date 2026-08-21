import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./store.js";

export const THROTTLE_MS = 30_000;

function throttlePath() {
  return join(stateDir(), "throttle.json");
}

function loadMap() {
  try {
    return JSON.parse(readFileSync(throttlePath(), "utf8"));
  } catch {
    return {};
  }
}

export function lastCheckMs(key) {
  const value = loadMap()[key];
  return typeof value === "number" ? value : 0;
}

export function recordCheck(key, now = Date.now()) {
  const map = loadMap();
  map[key] = now;
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(throttlePath(), `${JSON.stringify(map)}\n`, "utf8");
}

export function throttleElapsed(last, now = Date.now(), windowMs = THROTTLE_MS) {
  return now - last >= windowMs;
}
