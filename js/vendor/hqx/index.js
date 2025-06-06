import { resize, initSync } from './squooshhqx.js';
import wasmBase64 from './squooshhqx_bg.js';

let initialized = false;

function decodeBase64(b64) {
  const binary = atob(b64.trim());
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function initHqx() {
  if (!initialized) {
    const bytes = decodeBase64(wasmBase64);
    initSync(bytes);
    initialized = true;
  }
}

export function hqxScale(buffer32, width, height, factor) {
  initHqx();
  return resize(buffer32, width, height, factor);
}
