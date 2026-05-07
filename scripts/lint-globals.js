const readonly = 'readonly';

export const browserGlobals = Object.freeze({
  AbortController: readonly,
  Audio: readonly,
  Blob: readonly,
  CanvasRenderingContext2D: readonly,
  CompressionStream: readonly,
  CustomEvent: readonly,
  DOMParser: readonly,
  DecompressionStream: readonly,
  Event: readonly,
  File: readonly,
  FileReader: readonly,
  FormData: readonly,
  HTMLCanvasElement: readonly,
  HTMLElement: readonly,
  HTMLImageElement: readonly,
  Image: readonly,
  ImageBitmap: readonly,
  ImageData: readonly,
  IndexedDB: readonly,
  KeyboardEvent: readonly,
  MouseEvent: readonly,
  MutationObserver: readonly,
  OffscreenCanvas: readonly,
  Path2D: readonly,
  PointerEvent: readonly,
  ResizeObserver: readonly,
  Request: readonly,
  TextDecoder: readonly,
  TextEncoder: readonly,
  URL: readonly,
  URLSearchParams: readonly,
  WebSocket: readonly,
  WebAssembly: readonly,
  XMLHttpRequest: readonly,
  atob: readonly,
  btoa: readonly,
  cancelAnimationFrame: readonly,
  caches: readonly,
  clearInterval: readonly,
  clearTimeout: readonly,
  console: readonly,
  createImageBitmap: readonly,
  crypto: readonly,
  document: readonly,
  fetch: readonly,
  globalThis: readonly,
  history: readonly,
  indexedDB: readonly,
  localStorage: readonly,
  location: readonly,
  navigator: readonly,
  performance: readonly,
  queueMicrotask: readonly,
  requestAnimationFrame: readonly,
  self: readonly,
  sessionStorage: readonly,
  setInterval: readonly,
  setTimeout: readonly,
  structuredClone: readonly,
  window: readonly
});

export const nodeGlobals = Object.freeze({
  Buffer: readonly,
  __dirname: readonly,
  __filename: readonly,
  clearImmediate: readonly,
  exports: readonly,
  global: readonly,
  module: readonly,
  process: readonly,
  require: readonly,
  setImmediate: readonly
});

export const testGlobals = Object.freeze({
  after: readonly,
  afterEach: readonly,
  before: readonly,
  beforeEach: readonly,
  context: readonly,
  describe: readonly,
  expect: readonly,
  it: readonly,
  suite: readonly,
  test: readonly
});

export const thirdPartyBrowserGlobals = Object.freeze({
  $: readonly,
  JSZip: readonly,
  WebMidi: readonly,
  jQuery: readonly
});

export const projectRuntimeGlobals = Object.freeze({
  Lemmings: readonly,
  ShowDebug: readonly,
  lemmings: readonly,
  winH: readonly,
  winW: readonly,
  worldH: readonly,
  worldW: readonly
});

export const lintGlobals = Object.freeze({
  ...browserGlobals,
  ...nodeGlobals
});

export const testLintGlobals = Object.freeze({
  ...testGlobals,
  ...thirdPartyBrowserGlobals,
  ...projectRuntimeGlobals
});

export const checkUndefinedGlobals = Object.freeze({
  ...lintGlobals,
  ...testLintGlobals
});
