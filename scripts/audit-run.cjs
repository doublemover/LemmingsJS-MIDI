const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [label, ...args] = process.argv.slice(2);
const log = fs.createWriteStream(`evidence/${label}.log`);
const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => log.write(chunk));
const started = Date.now();
const heartbeat = setInterval(() => console.log(`${label}: running ${Math.round((Date.now() - started) / 1000)}s; output in evidence/${label}.log`), 10000);
child.on('exit', code => { clearInterval(heartbeat); log.end(); console.log(`${label}: exit ${code}`); process.exitCode = code; });
