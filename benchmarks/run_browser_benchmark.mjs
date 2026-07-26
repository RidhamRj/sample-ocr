import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const resultsDirectory = path.join(root, "benchmarks", "results");
await mkdir(resultsDirectory, { recursive: true });

const port = 4174;
const debuggingPort = 9224;
const server = spawn(
  "python3",
  ["-m", "http.server", String(port), "--directory", path.join(root, "public")],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const executable = [
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter((candidate) => candidate && existsSync(candidate))[0];
if (!executable) throw new Error("No Chromium/Chrome executable found");

const chrome = spawn(executable, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${debuggingPort}`,
  `http://127.0.0.1:${port}/benchmark.html`,
], { stdio: ["ignore", "pipe", "pipe"] });

let chromeStderr = "";
let serverStderr = "";
chrome.stderr?.on("data", (chunk) => { chromeStderr += chunk.toString(); });
server.stderr?.on("data", (chunk) => { serverStderr += chunk.toString(); });
const chromeExit = new Promise((_, reject) => {
  chrome.once("error", reject);
  chrome.once("exit", (code, signal) => {
    if (code && code !== 0) {
      reject(new Error(`Chromium exited before benchmark completion (${code}, ${signal ?? "no signal"})`));
    }
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let sequence = 0;
const pending = new Map();
const browserEvents = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

try {
  let target;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await Promise.race([
        fetch(`http://127.0.0.1:${debuggingPort}/json`),
        chromeExit,
      ]);
      const targets = await response.json();
      target = targets.find((item) => item.type === "page");
      if (target) break;
    } catch {
      // Chrome may still be starting.
    }
    await sleep(500);
  }
  if (!target) throw new Error("Chromium DevTools target did not start");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      browserEvents.push({ type: "exception", details: message.params?.exceptionDetails });
      return;
    }
    if (message.method === "Log.entryAdded") {
      browserEvents.push({ type: "log", entry: message.params?.entry });
      return;
    }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };

  await send("Runtime.enable");
  await send("Log.enable");
  let result;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const evaluation = await send("Runtime.evaluate", {
      expression: "window.__BENCHMARK_RESULT__ || null",
      returnByValue: true,
    });
    result = evaluation.result?.value;
    if (result) break;
    await sleep(500);
  }

  if (!result) {
    const pageState = await send("Runtime.evaluate", {
      expression: "({output: document.getElementById('output')?.textContent, readyState: document.readyState})",
      returnByValue: true,
    }).catch(() => null);
    const diagnostic = {
      error: "Browser benchmark timed out",
      pageState: pageState?.result?.value ?? null,
      browserEvents,
      chromeStderr: chromeStderr.slice(-12000),
      serverStderr: serverStderr.slice(-4000),
    };
    await writeFile(
      path.join(resultsDirectory, "candidate-a.json"),
      JSON.stringify(diagnostic, null, 2),
    );
    console.error(JSON.stringify(diagnostic, null, 2));
    process.exitCode = 1;
  } else {
    result.browserEvents = browserEvents;
    await writeFile(
      path.join(resultsDirectory, "candidate-a.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    const acceptanceFailed = Object.values(result.acceptance ?? {}).some((value) => value === false);
    if (result.error || acceptanceFailed) process.exitCode = 1;
  }
} finally {
  try { socket?.close(); } catch {}
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
}
