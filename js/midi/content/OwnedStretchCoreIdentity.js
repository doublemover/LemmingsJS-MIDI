import { freezeData } from '../../core/CanonicalData.js';

export const OWNED_STRETCH_CORE = freezeData({ schema: 'lemmings-pinned-stretch-core/v1', upstream: 'Signalsmith-Audio/signalsmith-stretch', version: '1.3.2', commit: 'a670068d9aeb64913331d5cc29337b19a457a7df',
  sourceUrl: 'https://raw.githubusercontent.com/Signalsmith-Audio/signalsmith-stretch/a670068d9aeb64913331d5cc29337b19a457a7df/web/emscripten/main.js', sourceBytes: 98451, sourceSha256: 'f4af9d616062c67dbfe6a98d9bfd39f0149246f02c111122a10936f5c63d5cf6',
  runtimePath: 'assets/audio/signalsmith-stretch-core.wasm', cachePath: 'dist/assets/signalsmith-stretch-core.wasm', wasmBytes: 64494, wasmSha256: '83869197b3c5ebf9fc8c517a1586aef1ecf77404842218d62b9c0e82882d8ca3', abi: 'signalsmith-1.3.2-a670068-minified-core-h-through-x-v1',
  sourceBinding: 'https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/a670068d9aeb64913331d5cc29337b19a457a7df/web/emscripten/main.cpp',
  imageModule: { revision: 'pinned-export-only-quiescent-stack-and-heap-image-v1', bytes: 64518, sha256: 'e5c48b760aac995264c12b32fc941e5ccc91eb5dc2c05cec6403ec0b5e05875f', stackExport: '__owned_stack_pointer', expectedQuiescentStack: 72800, evidence: 'static-export-only-derivation;no-WASM-compile-or-execution;runtime-state-transfer-unqualified' },
  dependencyMeaning: 'exact-precompiled-WASM-includes-its-Linear-code;source-build-reproducibility-not-established', wrapper: 'not-loaded-or-executed;no-mutable-vendor-scheduler', qualification: 'static-byte-fingerprint-only;core-runtime-and-device-qualification-pending' });
