#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
  DEFAULT_CAPTURE_ROOT,
  captureTargets,
  makeCaptureTimestamp,
  runVisualProbes,
  sanitizeCaptureName
} from '../e2e/helpers/visualCapture.js';
import { installExternalAssetStubs } from '../e2e/helpers/externalAssets.js';
import { resolvePlaywrightBaseUrl } from '../playwright.config.js';

const VIEWPORT_PRESETS = Object.freeze({
  desktop: {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1
  },
  tablet: {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 1
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1
  }
});

const parseCliArgs = (argv = process.argv.slice(2)) => {
  const parsed = {
    config: null,
    baseUrl: process.env.LEMMINGS_E2E_BASE_URL || null,
    outDir: null,
    viewport: 'desktop',
    targets: [],
    json: false,
    help: false
  };
  for (const rawArg of argv) {
    const arg = String(rawArg || '');
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg.startsWith('--config=')) {
      parsed.config = arg.slice('--config='.length).trim();
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      parsed.baseUrl = arg.slice('--base-url='.length).trim();
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length).trim();
      continue;
    }
    if (arg.startsWith('--viewport=')) {
      parsed.viewport = arg.slice('--viewport='.length).trim();
      continue;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length).trim();
      for (const item of value.split(',')) {
        const name = item.trim();
        if (name) parsed.targets.push(name);
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
};

const usage = () => [
  'Usage: node scripts/e2e-capture-rects.js --config=e2e/capture-targets/midi.js',
  '',
  'Options:',
  '  --base-url=https://localhost:8080',
  '  --out-dir=temp/e2e-captures/my-run',
  '  --viewport=desktop|tablet|mobile',
  '  --target=name[,name...]',
  '  --json'
].join('\n');

const loadConfig = async (configPath) => {
  if (!configPath) throw new Error('Missing required --config option.');
  const resolvedPath = path.resolve(configPath);
  const mod = await import(pathToFileURL(resolvedPath).href);
  const config = mod.default || mod.config || mod;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Capture config must export an object: ${resolvedPath}`);
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error(`Capture config must define a non-empty targets array: ${resolvedPath}`);
  }
  return {
    path: resolvedPath,
    config
  };
};

const buildCaptureUrl = (baseUrl, config) => {
  const route = config.route || '/';
  const url = new URL(route, baseUrl);
  if (config.e2e !== false) {
    url.searchParams.set('e2e', '1');
  }
  return url.href;
};

const selectTargets = (targets, selectedNames = []) => {
  if (!selectedNames.length) return targets;
  const selected = new Set(selectedNames);
  const matched = targets.filter(target => selected.has(target.name));
  const matchedNames = new Set(matched.map(target => target.name));
  const missing = selectedNames.filter(name => !matchedNames.has(name));
  if (missing.length) {
    throw new Error(`Unknown target(s): ${missing.join(', ')}`);
  }
  return matched;
};

const formatRect = (rect) => {
  if (!rect) return '(full viewport)';
  const round = value => Number(value).toFixed(1).replace(/\.0$/, '');
  return `${round(rect.x)},${round(rect.y)} ${round(rect.width)}x${round(rect.height)}`;
};

const printHumanSummary = (result) => {
  console.log(`Config: ${result.configName}`);
  console.log(`Route: ${result.url}`);
  console.log(`Viewport: ${result.viewportName} ${result.viewport.width}x${result.viewport.height}`);
  console.log(`Output: ${result.outDir}`);
  console.log('Captures:');
  for (const capture of result.captures) {
    const warnings = capture.warnings?.length ? ` warnings=${capture.warnings.join('; ')}` : '';
    console.log(`  - ${capture.name} [${capture.type}] ${formatRect(capture.clip || capture.rect)} -> ${capture.path}${warnings}`);
  }
  if (result.probes.issues.length) {
    console.log('Probe warnings:');
    const visibleIssues = result.probes.issues.slice(0, 40);
    for (const issue of visibleIssues) {
      const prefix = issue.required ? 'required' : 'warning';
      console.log(`  - ${prefix} ${issue.code} ${issue.selector}: ${issue.message}`);
    }
    if (result.probes.issues.length > visibleIssues.length) {
      console.log(`  - ... ${result.probes.issues.length - visibleIssues.length} more`);
    }
  } else {
    console.log('Probe warnings: none');
  }
};

const runCaptureCli = async (argv = process.argv.slice(2)) => {
  const args = parseCliArgs(argv);
  if (args.help) {
    return { help: true, text: usage(), exitCode: 0, json: args.json };
  }
  const viewportPreset = VIEWPORT_PRESETS[args.viewport];
  if (!viewportPreset) {
    throw new Error(`Unknown viewport preset: ${args.viewport}`);
  }
  const baseUrl = resolvePlaywrightBaseUrl(args.baseUrl);
  const loaded = await loadConfig(args.config);
  const configName = sanitizeCaptureName(
    loaded.config.name || path.basename(loaded.path, path.extname(loaded.path))
  );
  const targets = selectTargets(loaded.config.targets, args.targets);
  const url = buildCaptureUrl(baseUrl, loaded.config);
  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : path.join(DEFAULT_CAPTURE_ROOT, `${makeCaptureTimestamp()}-${configName}`);

  const browser = await chromium.launch();
  let context = null;
  try {
    context = await browser.newContext({
      baseURL: baseUrl,
      viewport: viewportPreset.viewport,
      deviceScaleFactor: viewportPreset.deviceScaleFactor,
      ignoreHTTPSErrors: true,
      permissions: ['midi']
    });
    const page = await context.newPage();
    await installExternalAssetStubs(page);
    await page.goto(url, { waitUntil: loaded.config.waitUntil || 'domcontentloaded' });
    if (typeof loaded.config.setup === 'function') {
      await loaded.config.setup(page, {
        baseUrl,
        url,
        viewportName: args.viewport,
        viewport: viewportPreset.viewport,
        config: loaded.config
      });
    }
    const captureResult = await captureTargets(page, targets, {
      outDir,
      route: new URL(url).pathname + new URL(url).search,
      viewport: viewportPreset.viewport
    });
    const probeResult = await runVisualProbes(page, loaded.config.probes || [], {
      minTapTargetSize: loaded.config.minTapTargetSize
    });
    const result = {
      ok: probeResult.failures.length === 0,
      configName,
      configPath: loaded.path,
      url,
      baseUrl,
      viewportName: args.viewport,
      viewport: viewportPreset.viewport,
      outDir: captureResult.outDir,
      captures: captureResult.captures,
      probes: probeResult
    };
    result.exitCode = result.ok ? 0 : 1;
    result.json = args.json;
    return result;
  } finally {
    await context?.close?.();
    await browser.close();
  }
};

const main = async () => {
  let json = process.argv.includes('--json');
  try {
    const result = await runCaptureCli();
    json = result.json;
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.help) {
      console.log(result.text);
    } else {
      printHumanSummary(result);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({
        ok: false,
        error: error?.message || String(error)
      }, null, 2));
    } else {
      console.error(error?.stack || error?.message || String(error));
    }
    process.exitCode = 1;
  }
};

const isMain = (() => {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main();
}

export {
  VIEWPORT_PRESETS,
  buildCaptureUrl,
  loadConfig,
  parseCliArgs,
  runCaptureCli,
  selectTargets
};
