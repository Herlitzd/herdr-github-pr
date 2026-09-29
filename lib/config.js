import { readFileSync } from "node:fs";
import { join } from "node:path";

export const POSITIONS = ["left", "right", "top", "bottom", "tab"];
export const DEFAULT_POSITION = "right";

export function configPath() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  return dir ? join(dir, "config.json") : null;
}

export function loadConfig() {
  const path = configPath();
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

// Precedence: HERDR_PR_PANE_POSITION env > config.json "pane_position" > "right".
export function panePosition(config = loadConfig()) {
  const raw = process.env.HERDR_PR_PANE_POSITION || config.pane_position;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return POSITIONS.includes(value) ? value : DEFAULT_POSITION;
}

// Herdr only splits right/down, so left/top split that way and then swap the new pane into place.
export function positionPlan(position) {
  switch (position) {
    case "left":
      return { placement: "split", direction: "right", swap: true };
    case "top":
      return { placement: "split", direction: "down", swap: true };
    case "bottom":
      return { placement: "split", direction: "down", swap: false };
    case "tab":
      return { placement: "tab", direction: null, swap: false };
    default:
      return { placement: "split", direction: "right", swap: false };
  }
}
