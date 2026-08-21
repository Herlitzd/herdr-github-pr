import { spawnSync } from "node:child_process";

export function herdrBin() {
  return process.env.HERDR_BIN_PATH || "herdr";
}

export function runHerdr(args, options = {}) {
  const result = spawnSync(herdrBin(), args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function herdrJson(args) {
  const result = runHerdr(args);
  if (result.error) {
    throw result.error;
  }
  const text = (result.stdout || result.stderr).trim();
  if (!text) {
    return { ok: false, status: result.status, stderr: result.stderr };
  }
  try {
    const data = JSON.parse(text);
    return { ok: result.status === 0 && !data.error, status: result.status, data, stderr: result.stderr };
  } catch {
    return { ok: false, status: result.status, stderr: result.stderr || text };
  }
}


export function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
