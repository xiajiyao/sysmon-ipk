#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const { execSync, exec } = require('child_process');

const PORT = parseInt(process.env.SYSMON_PORT || '29999');

// --- Helpers ---

function readFile(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch { return ''; }
}

function parseNetDev() {
  const lines = readFile('/proc/net/dev').trim().split('\n').slice(2);
  const result = {};
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const iface = parts[0].replace(':', '');
    result[iface] = { rx: parseInt(parts[1]), tx: parseInt(parts[9]) };
  }
  return result;
}

// --- Network state ---
let prevNet = parseNetDev();
let prevNetTime = Date.now();

// --- Docker cache (updated every 5s to avoid blocking requests) ---
let dockerCache = [];
function refreshDocker() {
  try {
    const lines = execSync(
      "docker ps --format '{\"id\":\"{{.ID}}\",\"name\":\"{{.Names}}\",\"image\":\"{{.Image}}\",\"status\":\"{{.Status}}\",\"ports\":\"{{.Ports}}\"}'",
      { timeout: 4000 }
    ).toString().trim().split('\n').filter(Boolean);

    dockerCache = lines.map(line => {
      const c = JSON.parse(line);
      let cpu = 0, mem = '0MB';
      try {
        const s = execSync(`docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' ${c.id}`, { timeout: 3000 })
          .toString().trim();
        const [cpuStr, memStr] = s.split(',');
        cpu = parseFloat(cpuStr) || 0;
        mem = (memStr || '0MB').split('/')[0].trim();
      } catch {}
      return { ...c, cpu, mem, uptime: c.status };
    });
  } catch {
    dockerCache = [];
  }
}
// Initial fetch + refresh every 5s
refreshDocker();
setInterval(refreshDocker, 5000);

// --- Data collectors ---

function getCpu() {
  const parts = readFile('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle  = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);

  const prev = getCpu._prev || { idle, total };
  const dIdle  = idle  - prev.idle;
  const dTotal = total - prev.total;
  getCpu._prev = { idle, total };

  const usage = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0;

  let temp = 0;
  for (let i = 0; i < 8; i++) {
    const raw = readFile(`/sys/class/thermal/thermal_zone${i}/temp`).trim();
    if (raw) { temp = Math.round(parseInt(raw) / 1000); break; }
  }

  const loadParts = readFile('/proc/loadavg').trim().split(' ');
  const load = [parseFloat(loadParts[0]), parseFloat(loadParts[1]), parseFloat(loadParts[2])];

  return { usage, temp, load };
}

function getMemory() {
  const map = {};
  for (const line of readFile('/proc/meminfo').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) map[m[1]] = parseInt(m[2]);
  }
  const toGB = kb => Math.round(kb / 1024 / 1024 * 10) / 10;
  return {
    total:   toGB(map.MemTotal   || 0),
    used:    toGB((map.MemTotal  || 0) - (map.MemFree || 0) - (map.Buffers || 0) - (map.Cached || 0)),
    buffers: toGB(map.Buffers    || 0),
    cache:   toGB(map.Cached     || 0),
  };
}

function getStorage() {
  let system = 0, data = 0, total = 0;
  try {
    const lines = execSync('df -k', { timeout: 2000 }).toString().trim().split('\n').slice(1);
    for (const line of lines) {
      const p = line.trim().split(/\s+/);
      if (p.length < 6) continue;
      const usedGB  = Math.round(parseInt(p[2]) / 1024 / 1024 * 10) / 10;
      const totalGB = Math.round(parseInt(p[1]) / 1024 / 1024 * 10) / 10;
      if (p[5] === '/') { system = usedGB; total = totalGB; }
      else if (p[5] === '/data') { data = usedGB; }
    }
  } catch {}
  return { system, data, total, readIops: 0, writeIops: 0, health: 'OK' };
}

function getNetwork() {
  const now  = Date.now();
  const curr = parseNetDev();
  const dt   = Math.max((now - prevNetTime) / 1000, 0.1);

  let rxBytes = 0, txBytes = 0;
  for (const iface of Object.keys(curr)) {
    if (iface === 'lo') continue;
    const prev = prevNet[iface] || { rx: 0, tx: 0 };
    rxBytes += Math.max(0, curr[iface].rx - prev.rx);
    txBytes += Math.max(0, curr[iface].tx - prev.tx);
  }
  prevNet     = curr;
  prevNetTime = now;

  const toMbps = b => Math.round(b / dt / 1024 / 1024 * 100) / 100;

  let activeConns = 0;
  try {
    const line = readFile('/proc/net/sockstat').split('\n').find(l => l.startsWith('TCP:'));
    if (line) activeConns = parseInt(line.split(/\s+/)[3]) || 0;
  } catch {}

  return { up: toMbps(txBytes), down: toMbps(rxBytes), activeConns, history: Array(20).fill(0) };
}

function collectStats() {
  return {
    cpu:         getCpu(),
    memory:      getMemory(),
    storage:     getStorage(),
    network:     getNetwork(),
    docker:      dockerCache,
    binaryNoise: Array.from({ length: 8 }, () => Math.round(Math.random())).join(''),
    uptime:      Math.floor(parseFloat(readFile('/proc/uptime').trim().split(' ')[0])),
  };
}

// --- HTTP server ---

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/api/stats') {
    try {
      res.writeHead(200, CORS);
      res.end(JSON.stringify(collectStats()));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found' }));
}).listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`sysmon-server listening on :${PORT}\n`);
});
