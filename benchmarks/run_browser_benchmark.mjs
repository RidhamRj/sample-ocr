import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname), resultsDirectory = path.join(root, "benchmarks", "results"); await mkdir(resultsDirectory, { recursive: true });
const port = 4174, debuggingPort = 9224, server = spawn("python3", ["-m", "http.server", String(port), "--directory", path.join(root, "public")], { stdio: "ignore" });
const executable = [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].filter((candidate) => candidate && existsSync(candidate))[0];
if (!executable) throw new Error("No Chromium/Chrome executable found");
const chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${debuggingPort}`, `http://127.0.0.1:${port}/benchmark.html`], { stdio: "ignore" });
const chromeExit = new Promise((_, reject) => { chrome.once("error", reject); chrome.once("exit", (code, signal) => { if (code && code !== 0) reject(new Error(`Chromium exited before benchmark completion (${code}, ${signal ?? "no signal"})`)); }); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); let socket, sequence = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
try {
  let target;
  for (let attempt = 0; attempt < 60; attempt++) { try { const response = await Promise.race([fetch(`http://127.0.0.1:${debuggingPort}/json`), chromeExit]); const targets = await response.json(); target = targets.find((item) => item.type === "page"); if (target) break; } catch {} await sleep(500); }
  if (!target) throw new Error("Chromium DevTools target did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (!message.id) return; const request = pending.get(message.id); if (!request) return; pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); };
  await send("Runtime.enable"); let result;
  for (let attempt = 0; attempt < 240; attempt++) { const evaluation = await send("Runtime.evaluate", { expression: "window.__BENCHMARK_RESULT__ || null", returnByValue: true }); result = evaluation.result?.value; if (result) break; await sleep(500); }
  if (!result) throw new Error("Browser benchmark timed out"); await writeFile(path.join(resultsDirectory, "candidate-a.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); if (result.error) process.exitCode = 1;
} finally { try { socket?.close(); } catch {} chrome.kill("SIGTERM"); server.kill("SIGTERM"); }
