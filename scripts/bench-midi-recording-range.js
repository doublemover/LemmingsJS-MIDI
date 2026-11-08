import os from 'node:os';
import { benchmarkRecordingRanges } from '../test/support/recording-range-benchmark.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const argument = (key, fallback) => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3) ?? fallback;
const name = argument('name', 'rook'), sizes = argument('sizes', '1000,10000,100000,1000000').split(',').map(Number), iterations = Number(argument('iterations', '64'));
const result = await benchmarkRecordingRanges({ createPorts: createProcgenMidiPorts, createBudget: createResourceBudget, sizes, iterations,
  collectMemory: async () => { globalThis.gc?.(); return process.memoryUsage(); } });
console.log(JSON.stringify({ ...result, environment: { name, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model ?? null, logicalProcessors: os.availableParallelism(), memoryBytes: os.totalmem(), explicitGc: typeof globalThis.gc === 'function' } }, null, 2));
