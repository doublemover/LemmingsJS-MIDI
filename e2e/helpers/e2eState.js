import { Buffer } from 'buffer';

const decodeBase64 = (data) => {
  if (!data) return Buffer.alloc(0);
  return Buffer.from(data, 'base64');
};

const buildTypedArray = (dtype, bytes) => {
  switch (dtype) {
  case 'u8':
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  case 'u8c':
    return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  case 'u16':
    return new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  case 'u32':
    return new Uint32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  case 'i8':
    return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  case 'i16':
    return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  case 'i32':
    return new Int32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  case 'f32':
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  case 'f64':
    return new Float64Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 8));
  default:
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
};

const decodeE2EBuffer = (bufferSpec) => {
  if (!bufferSpec || !bufferSpec.data) return null;
  const bytes = decodeBase64(bufferSpec.data);
  const array = buildTypedArray(bufferSpec.dtype, bytes);
  return {
    ...bufferSpec,
    bytes,
    array
  };
};

export { decodeBase64, decodeE2EBuffer };
