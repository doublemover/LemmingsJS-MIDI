import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CAPTURE_ROOT = path.resolve('temp', 'e2e-captures');
const DEFAULT_IMAGE_EXTENSION = 'png';
const DEFAULT_MIN_TAP_TARGET_SIZE = 32;
const CAPTURE_TARGET_TYPES = Object.freeze(new Set([
  'selector',
  'pageRect',
  'runtimeRect',
  'runtimeRects',
  'worldRect',
  'viewport',
  'fullPage'
]));

const sanitizeCaptureName = (name) => {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || 'capture';
};

const makeCaptureTimestamp = (date = new Date()) => (
  date.toISOString().replace(/[:.]/g, '-')
);

const isPathInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveCaptureOutputDir = async (outDir, options = {}) => {
  const root = path.resolve(options.captureRoot || DEFAULT_CAPTURE_ROOT);
  const resolved = path.resolve(outDir || path.join(root, makeCaptureTimestamp()));
  if (!isPathInside(root, resolved)) {
    throw new Error(`Capture output must stay under ${root}: ${resolved}`);
  }
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
};

const normalizeClipRect = (rect, viewport = null) => {
  const x = Number(rect?.x ?? rect?.left);
  const y = Number(rect?.y ?? rect?.top);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid clip rectangle: ${JSON.stringify(rect)}`);
  }

  if (!viewport) return { x, y, width, height };
  const viewportWidth = Number(viewport.width);
  const viewportHeight = Number(viewport.height);
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
    return { x, y, width, height };
  }
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(viewportWidth, x + width);
  const bottom = Math.min(viewportHeight, y + height);
  if (right <= left || bottom <= top) {
    throw new Error(`Clip rectangle is outside the viewport: ${JSON.stringify(rect)}`);
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
};

const summarizeTarget = (target) => {
  const parts = [
    `target=${target?.name || '(unnamed)'}`,
    `type=${target?.type || '(missing)'}`
  ];
  if (target?.selector) parts.push(`selector=${target.selector}`);
  if (target?.id) parts.push(`id=${target.id}`);
  return parts.join(' ');
};

const getRouteLabel = (page, options = {}) => {
  if (options.route) return options.route;
  try {
    const url = page.url?.();
    if (!url) return '(unknown route)';
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return page.url?.() || '(unknown route)';
  }
};

const collectNearbySelectors = async (page) => {
  try {
    return await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[id], [class]')).slice(0, 36);
      return nodes.map((node) => {
        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const className = typeof node.className === 'string'
          ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(item => `.${item}`).join('')
          : '';
        return `${tag}${id}${className}`;
      });
    });
  } catch {
    return [];
  }
};

const createCaptureError = (message, { page, target, options = {}, availableRuntimeRectIds = [], nearby = [] }) => {
  const lines = [
    message,
    `Route: ${getRouteLabel(page, options)}`,
    `Target: ${summarizeTarget(target)}`
  ];
  if (availableRuntimeRectIds.length) {
    lines.push(`Available runtime rect ids: ${availableRuntimeRectIds.join(', ')}`);
  }
  if (nearby.length) {
    lines.push(`Nearby page ids/classes: ${nearby.join(', ')}`);
  }
  return new Error(lines.join('\n'));
};

const validateTarget = (target) => {
  if (!target || typeof target !== 'object') {
    throw new Error('Capture target must be an object.');
  }
  if (!target.name || typeof target.name !== 'string') {
    throw new Error(`Capture target is missing a string name: ${JSON.stringify(target)}`);
  }
  if (!CAPTURE_TARGET_TYPES.has(target.type)) {
    throw new Error(`Unsupported capture target type for ${target.name}: ${target.type}`);
  }
};

const getRuntimeCaptureRects = async (page, captureOptions = null, target = null, options = {}) => {
  const result = await page.evaluate((rectOptions) => {
    const api = window.__E2E__;
    if (!api || typeof api.getCaptureRects !== 'function') {
      return { missingApi: true };
    }
    return api.getCaptureRects(rectOptions || undefined);
  }, captureOptions);
  if (result?.missingApi) {
    throw createCaptureError('window.__E2E__.getCaptureRects() is not available.', {
      page,
      target,
      options
    });
  }
  if (!result || result.version !== 1 || !result.rects) {
    throw createCaptureError('window.__E2E__.getCaptureRects() returned an invalid payload.', {
      page,
      target,
      options
    });
  }
  return result;
};

const buildResolvedTarget = ({ target, name, type, rect = null, clip = null, mode = 'clip', runtimeId = null }) => ({
  name,
  type,
  sourceTarget: target,
  runtimeId,
  rect,
  clip,
  mode
});

const resolveSelectorTarget = async (page, target, options, viewport) => {
  if (!target.selector || typeof target.selector !== 'string') {
    throw createCaptureError('Selector capture target is missing a selector.', { page, target, options });
  }
  const locator = page.locator(target.selector);
  const count = await locator.count();
  if (count !== 1) {
    const nearby = await collectNearbySelectors(page);
    throw createCaptureError(`Expected exactly one element but found ${count}.`, {
      page,
      target,
      options,
      nearby
    });
  }
  const element = locator.first();
  await element.scrollIntoViewIfNeeded();
  const visible = await element.isVisible();
  if (options.requireVisibleSelectors !== false && !visible) {
    throw createCaptureError('Selector matched one element, but it is not visible.', {
      page,
      target,
      options
    });
  }
  const rect = await element.boundingBox();
  if (!rect) {
    throw createCaptureError('Selector matched one element, but it has no bounding box.', {
      page,
      target,
      options
    });
  }
  const clip = normalizeClipRect(rect, options.clipToViewport === false ? null : viewport);
  return buildResolvedTarget({
    target,
    name: target.name,
    type: target.type,
    rect,
    clip
  });
};

const resolveRuntimeRectTarget = async (page, target, options, viewport) => {
  const runtime = await getRuntimeCaptureRects(page, null, target, options);
  const available = Object.keys(runtime.rects).sort();
  const rect = runtime.rects[target.id];
  if (!rect) {
    throw createCaptureError('Requested runtime rectangle is not available.', {
      page,
      target,
      options,
      availableRuntimeRectIds: available
    });
  }
  const clip = normalizeClipRect(rect, options.clipToViewport === false ? null : viewport);
  return buildResolvedTarget({
    target,
    name: target.name,
    type: target.type,
    rect,
    clip,
    runtimeId: target.id
  });
};

const resolveRuntimeRectsTarget = async (page, target, options, viewport) => {
  const runtime = await getRuntimeCaptureRects(page, null, target, options);
  const available = Object.keys(runtime.rects).sort();
  const requested = Array.isArray(target.ids) && target.ids.length
    ? target.ids.map(id => String(id))
    : available;
  const captures = [];
  const missing = [];
  for (const id of requested) {
    const rect = runtime.rects[id];
    if (!rect) {
      missing.push(id);
      continue;
    }
    const clip = normalizeClipRect(rect, options.clipToViewport === false ? null : viewport);
    const name = target.name === id ? id : `${target.name}-${id}`;
    captures.push(buildResolvedTarget({
      target,
      name,
      type: target.type,
      rect,
      clip,
      runtimeId: id
    }));
  }
  if (!captures.length) {
    throw createCaptureError('No requested runtime rectangles are available.', {
      page,
      target,
      options,
      availableRuntimeRectIds: available
    });
  }
  if (missing.length) {
    captures[0].warnings = [`Missing runtime rect ids: ${missing.join(', ')}`];
  }
  return captures;
};

const resolveWorldRectTarget = async (page, target, options, viewport) => {
  const runtime = await getRuntimeCaptureRects(page, {
    worldRect: {
      id: target.name,
      rect: target.rect,
      padding: target.padding
    }
  }, target, options);
  const available = Object.keys(runtime.rects).sort();
  const rect = runtime.rects[target.name];
  if (!rect) {
    throw createCaptureError('World rectangle could not be converted to a page rectangle.', {
      page,
      target,
      options,
      availableRuntimeRectIds: available
    });
  }
  const clip = normalizeClipRect(rect, options.clipToViewport === false ? null : viewport);
  return buildResolvedTarget({
    target,
    name: target.name,
    type: target.type,
    rect,
    clip,
    runtimeId: target.name
  });
};

const resolveCaptureTargets = async (page, targets, options = {}) => {
  if (!Array.isArray(targets)) {
    throw new Error('Capture targets must be an array.');
  }
  const viewport = options.viewport || page.viewportSize?.() || null;
  const resolved = [];
  for (const target of targets) {
    validateTarget(target);
    switch (target.type) {
    case 'selector':
      resolved.push(await resolveSelectorTarget(page, target, options, viewport));
      break;
    case 'pageRect': {
      const clip = normalizeClipRect(target.rect, options.clipToViewport === false ? null : viewport);
      resolved.push(buildResolvedTarget({
        target,
        name: target.name,
        type: target.type,
        rect: target.rect,
        clip
      }));
      break;
    }
    case 'runtimeRect':
      resolved.push(await resolveRuntimeRectTarget(page, target, options, viewport));
      break;
    case 'runtimeRects':
      resolved.push(...await resolveRuntimeRectsTarget(page, target, options, viewport));
      break;
    case 'worldRect':
      resolved.push(await resolveWorldRectTarget(page, target, options, viewport));
      break;
    case 'viewport':
      resolved.push(buildResolvedTarget({
        target,
        name: target.name,
        type: target.type,
        mode: 'viewport'
      }));
      break;
    case 'fullPage':
      resolved.push(buildResolvedTarget({
        target,
        name: target.name,
        type: target.type,
        mode: 'fullPage'
      }));
      break;
    default:
      throw new Error(`Unsupported capture target type: ${target.type}`);
    }
  }
  return resolved;
};

const nextCapturePath = (outDir, name, usedNames, extension = DEFAULT_IMAGE_EXTENSION) => {
  const base = sanitizeCaptureName(name);
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  usedNames.add(candidate);
  return path.join(outDir, `${candidate}.${extension}`);
};

const captureTargets = async (page, targets, options = {}) => {
  const outDir = await resolveCaptureOutputDir(options.outDir, options);
  const resolved = await resolveCaptureTargets(page, targets, options);
  const usedNames = new Set();
  const captures = [];
  for (const item of resolved) {
    const outputPath = nextCapturePath(outDir, item.name, usedNames, options.extension);
    if (item.mode === 'fullPage') {
      await page.screenshot({ path: outputPath, fullPage: true });
    } else if (item.mode === 'viewport') {
      await page.screenshot({ path: outputPath });
    } else {
      await page.screenshot({ path: outputPath, clip: item.clip });
    }
    captures.push({
      name: item.name,
      type: item.type,
      runtimeId: item.runtimeId,
      rect: item.rect || null,
      clip: item.clip || null,
      path: outputPath,
      warnings: item.warnings || []
    });
  }
  return {
    version: 1,
    outDir,
    captures
  };
};

const normalizeProbe = (probe) => {
  if (typeof probe === 'string') {
    return { name: probe, selector: probe, required: false };
  }
  return {
    name: probe?.name || probe?.selector || 'probe',
    selector: probe?.selector,
    required: probe?.required === true,
    checks: Array.isArray(probe?.checks) ? probe.checks : null
  };
};

const runVisualProbes = async (page, probes = [], options = {}) => {
  const normalized = probes.map(normalizeProbe);
  const issues = await page.evaluate(({ probes: browserProbes, probeOptions }) => {
    const allChecks = new Set([
      'missingSelector',
      'horizontalOverflow',
      'verticalOverflow',
      'clippedText',
      'zeroSizeVisibleText',
      'hiddenFocusedElement',
      'smallTapTarget',
      'unexpectedScrollbar'
    ]);
    const minTapTargetSize = Number.isFinite(probeOptions.minTapTargetSize)
      ? probeOptions.minTapTargetSize
      : 32;
    const issueList = [];
    const describeNode = (node) => {
      if (!node) return '(missing)';
      const tag = node.tagName?.toLowerCase?.() || 'node';
      const id = node.id ? `#${node.id}` : '';
      const cls = typeof node.className === 'string' && node.className.trim()
        ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
      return `${tag}${id}${cls}`;
    };
    const rectFor = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    };
    const isRendered = (node) => {
      if (!node || typeof node.getBoundingClientRect !== 'function') return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const hasCheck = (probe, check) => !probe.checks || probe.checks.includes(check);
    const pushIssue = (probe, code, message, node = null) => {
      if (probe.checks && !allChecks.has(code)) return;
      issueList.push({
        probe: probe.name,
        selector: probe.selector,
        required: probe.required === true,
        code,
        message,
        target: describeNode(node),
        rect: node ? rectFor(node) : null
      });
    };

    for (const probe of browserProbes) {
      if (!probe.selector) {
        issueList.push({
          probe: probe.name,
          selector: '',
          required: probe.required === true,
          code: 'missingSelector',
          message: 'Probe is missing a selector.',
          target: '(probe)',
          rect: null
        });
        continue;
      }
      const roots = Array.from(document.querySelectorAll(probe.selector));
      if (!roots.length) {
        pushIssue(probe, 'missingSelector', 'Probe selector did not match any elements.');
        continue;
      }
      for (const root of roots) {
        if (hasCheck(probe, 'horizontalOverflow') && root.scrollWidth > root.clientWidth + 1) {
          pushIssue(probe, 'horizontalOverflow', 'Element scrollWidth exceeds clientWidth.', root);
        }
        if (hasCheck(probe, 'verticalOverflow') && root.scrollHeight > root.clientHeight + 1) {
          pushIssue(probe, 'verticalOverflow', 'Element scrollHeight exceeds clientHeight.', root);
        }
        const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
        for (const node of candidates) {
          const text = String(node.textContent || '').trim();
          if (!text) continue;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const visibleByStyle = style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            node.getClientRects().length > 0;
          if (
            hasCheck(probe, 'zeroSizeVisibleText') &&
            visibleByStyle &&
            (rect.width <= 0 || rect.height <= 0)
          ) {
            pushIssue(probe, 'zeroSizeVisibleText', 'Visible text node has zero-size layout.', node);
          }
          if (
            hasCheck(probe, 'clippedText') &&
            isRendered(node) &&
            (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
          ) {
            pushIssue(probe, 'clippedText', 'Text content is clipped by its element box.', node);
          }
        }
        const tapTargets = candidates.filter(node => (
          node.matches?.('button, a[href], input, select, textarea, [role="button"], [tabindex]')
        ));
        for (const node of tapTargets) {
          if (!isRendered(node)) continue;
          const rect = node.getBoundingClientRect();
          if (
            hasCheck(probe, 'smallTapTarget') &&
            (rect.width < minTapTargetSize || rect.height < minTapTargetSize)
          ) {
            pushIssue(probe, 'smallTapTarget', 'Interactive target is below the minimum practical size.', node);
          }
        }
        const rootStyle = window.getComputedStyle(root);
        const scrollX = /auto|scroll/.test(rootStyle.overflowX) && root.scrollWidth > root.clientWidth + 1;
        const scrollY = /auto|scroll/.test(rootStyle.overflowY) && root.scrollHeight > root.clientHeight + 1;
        if (hasCheck(probe, 'unexpectedScrollbar') && (scrollX || scrollY)) {
          pushIssue(probe, 'unexpectedScrollbar', 'Element has a visible overflow scrollbar.', root);
        }
      }
    }

    const focused = document.activeElement;
    if (focused && focused !== document.body && !isRendered(focused)) {
      for (const probe of browserProbes) {
        if (hasCheck(probe, 'hiddenFocusedElement')) {
          pushIssue(probe, 'hiddenFocusedElement', 'Focused element is hidden or zero-size.', focused);
        }
      }
    }
    const doc = document.documentElement;
    const body = document.body;
    const hasPageScrollbar = (
      doc.scrollWidth > window.innerWidth + 2 ||
      body.scrollWidth > window.innerWidth + 2 ||
      doc.scrollHeight > window.innerHeight + 2 ||
      body.scrollHeight > window.innerHeight + 2
    );
    if (hasPageScrollbar) {
      for (const probe of browserProbes) {
        if (hasCheck(probe, 'unexpectedScrollbar')) {
          pushIssue(probe, 'unexpectedScrollbar', 'Page has an unexpected document-level scrollbar.', doc);
        }
      }
    }
    return issueList;
  }, {
    probes: normalized,
    probeOptions: {
      minTapTargetSize: options.minTapTargetSize || DEFAULT_MIN_TAP_TARGET_SIZE
    }
  });
  return {
    version: 1,
    issues,
    warnings: issues.filter(issue => !issue.required),
    failures: issues.filter(issue => issue.required)
  };
};

export {
  DEFAULT_CAPTURE_ROOT,
  captureTargets,
  makeCaptureTimestamp,
  normalizeClipRect,
  resolveCaptureOutputDir,
  resolveCaptureTargets,
  runVisualProbes,
  sanitizeCaptureName
};
