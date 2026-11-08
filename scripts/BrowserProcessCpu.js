import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const execute = promisify(execFile), LIMIT = 4096;
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const counter = value => typeof value === 'string' && /^\d{1,32}$/.test(value);
const fail = message => { throw new TypeError(message); };

export function parseLinuxProcessCpu(text, ticksPerSecond) {
  if (typeof text !== 'string' || text.length > 65536 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 1 || ticksPerSecond > 1000000) fail('Invalid process CPU stat.');
  const close = text.lastIndexOf(')'), pid = Number(text.slice(0, text.indexOf(' '))), fields = text.slice(close + 2).trim().split(/\s+/);
  if (close < 0 || fields.length < 20 || !integer(pid) || !pid || !integer(Number(fields[1])) || ![fields[11], fields[12], fields[19]].every(counter)) fail('Invalid process CPU stat.');
  return { pid, parentPid: Number(fields[1]), identity: fields[19], cpuNs: ((BigInt(fields[11]) + BigInt(fields[12])) * 1000000000n / BigInt(ticksPerSecond)).toString() };
}

export function selectBrowserProcessTree(records, rootPid) {
  if (!Array.isArray(records) || records.length > LIMIT || !integer(rootPid) || !rootPid) fail('Invalid browser CPU process tree.');
  const byPid = new Map(), children = new Map();
  for (const item of records) {
    if (!item || !integer(item.pid) || !integer(item.parentPid) || !counter(item.identity) || !counter(item.cpuNs) || byPid.has(item.pid)) fail('Invalid browser CPU process record.');
    byPid.set(item.pid, item);
    if (!children.has(item.parentPid)) children.set(item.parentPid, []);
    children.get(item.parentPid).push(item.pid);
  }
  if (!byPid.has(rootPid)) throw new Error('The owned browser process is not observable.');
  const pending = [rootPid], selected = [], seen = new Set();
  while (pending.length) {
    const pid = pending.pop(); if (seen.has(pid)) fail('Cyclic browser CPU process tree.'); seen.add(pid);
    selected.push(Object.freeze({ ...byPid.get(pid) })); pending.push(...children.get(pid) || []);
  }
  return Object.freeze(selected.sort((a, b) => a.pid - b.pid));
}

const windowsCommand = '$ErrorActionPreference=\'Stop\'; $cpuRows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,KernelModeTime,UserModeTime | ForEach-Object { if ($null -ne $_.CreationDate -and $null -ne $_.KernelModeTime -and $null -ne $_.UserModeTime) { [pscustomobject]@{ pid=[int64]$_.ProcessId; parentPid=[int64]$_.ParentProcessId; identity=([datetime]$_.CreationDate).ToUniversalTime().Ticks.ToString(); cpuNs=(([bigint]$_.KernelModeTime + [bigint]$_.UserModeTime) * 100).ToString() } } }); ConvertTo-Json -InputObject $cpuRows -Compress';

export function createBrowserProcessCpuObserver({ platform = process.platform, readFile = fs.readFile, readdir = fs.readdir, run = execute, nowMs = () => performance.now() } = {}) {
  let tickRate = null;
  const linux = async () => {
    if (tickRate === null) { const result = await run('getconf', ['CLK_TCK'], { timeout: 10000, maxBuffer: 65536 }); tickRate = Number(result.stdout.trim()); }
    const entries = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
    if (entries.length > LIMIT) throw new Error('Process CPU inventory exceeds its bounded profile.');
    const rows = []; let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, async () => {
      while (cursor < entries.length) {
        const name = entries[cursor++];
        try { rows.push(parseLinuxProcessCpu(await readFile('/proc/' + name + '/stat', 'utf8'), tickRate)); } catch { /* Exited or inaccessible processes are not attributed. */ }
      }
    }));
    return rows;
  };
  return Object.freeze({ async sample(rootPid) {
    const startedMs = nowMs(); let rows;
    if (platform === 'linux') rows = await linux();
    else if (platform === 'win32') {
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', windowsCommand], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1048576 });
      rows = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    } else throw new Error('Process CPU observation is unavailable on this host.');
    const processes = selectBrowserProcessTree(rows, rootPid), completedMs = nowMs();
    if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs) throw new Error('Invalid process CPU observation clock.');
    return Object.freeze({ schema: 'lemmings-browser-process-cpu/v1', platform, rootPid, startedMs, completedMs, processes });
  } });
}

export function compareBrowserProcessCpu(before, after) {
  if (before?.schema !== 'lemmings-browser-process-cpu/v1' || after?.schema !== before.schema || before.platform !== after.platform || before.rootPid !== after.rootPid ||
      ![before.startedMs, before.completedMs, after.startedMs, after.completedMs].every(Number.isFinite) || before.completedMs < before.startedMs || after.completedMs < after.startedMs || after.startedMs < before.completedMs) fail('Incompatible process CPU observations.');
  const first = selectBrowserProcessTree(before.processes, before.rootPid), last = selectBrowserProcessTree(after.processes, after.rootPid), previous = new Map(first.map(row => [row.pid, row]));
  let cpuNs = 0n, matched = 0;
  for (const row of last) {
    const prior = previous.get(row.pid); if (!prior || prior.identity !== row.identity) continue;
    const delta = BigInt(row.cpuNs) - BigInt(prior.cpuNs); if (delta < 0) fail('Process CPU counter regressed.'); cpuNs += delta; matched++;
  }
  const root = previous.get(after.rootPid), nextRoot = last.find(row => row.pid === after.rootPid);
  if (!root || root.identity !== nextRoot?.identity) fail('Owned browser process was replaced.');
  const wallMs = (after.startedMs + after.completedMs - before.startedMs - before.completedMs) / 2;
  const cpuMs = Number(cpuNs) / 1000000;
  if (!(wallMs > 0) || !Number.isFinite(cpuMs)) fail('Invalid process CPU interval.');
  return Object.freeze({ cpuMs, wallMs, coreEquivalent: cpuMs / wallMs, matchedProcesses: matched,
    populationStable: matched === first.length && matched === last.length, beforeProcesses: first.length, afterProcesses: last.length,
    samplingUncertaintyMs: (before.completedMs - before.startedMs + after.completedMs - after.startedMs) / 2,
    scope: 'observed-owned-browser-process-tree-user-plus-kernel-not-exclusive-dsp-or-host-total' });
}

export function summarizeProfileSamples(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.length > 32 || samples.some(value => !Number.isFinite(value) || value < 0)) fail('Invalid profile distribution.');
  const sorted = [...samples].sort((a, b) => a - b), at = fraction => sorted[Math.ceil(fraction * (sorted.length - 1))];
  return Object.freeze({ samples: sorted.length, minimum: sorted[0], median: at(0.5), p95: at(0.95), maximum: sorted.at(-1) });
}
