export function surveyCanonicalVectors() {
  const backing = new Float64Array([77, -0, 0, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE, -Number.MIN_VALUE, 88]);
  const vectors = [
    ['scalar', [-0, 0, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE]],
    ['float64-subview', new Float64Array(backing.buffer, 8, 9)],
    ['float32', new Float32Array([-0, 0, NaN, Infinity, -Infinity, 3.4028234663852886e38, 1.401298464324817e-45])],
    ['int8', new Int8Array([-128, 0, 127])], ['uint8', new Uint8Array([0, 255])],
    ['clamped', new Uint8ClampedArray([-1, 128, 999])], ['int16', new Int16Array([-32768, 32767])],
    ['uint16', new Uint16Array([0, 65535])], ['int32', new Int32Array([-2147483648, 2147483647])],
    ['uint32', new Uint32Array([0, 4294967295])], ['bigint64', new BigInt64Array([-9223372036854775808n, 9223372036854775807n])],
    ['biguint64', new BigUint64Array([0n, 18446744073709551615n])],
    ['data-view', new DataView(Uint8Array.of(99, 0, 255, 88).buffer, 1, 2)],
    ['array-buffer', Uint8Array.of(0, 1, 255).buffer], ['sparse', [0, , undefined, null]],
    ['containers', { map: new Map([['z', 1], ['a', 2]]), set: new Set([3, 1]), nullPrototype: Object.assign(Object.create(null), { zero: -0 }) }]
  ];
  return vectors;
}
