const fail = () => { throw Object.assign(new Error('The prepared processors have no shared audio-frame frontier within the activation horizon.'), { code: 'incompatible-audio-frame-grid' }); };
const mod = (value, divisor) => (value % divisor + divisor) % divisor;
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const inverse = (a, b) => {
  let coefficient = 1n, next = 0n, divisor = b;
  while (divisor) { const quotient = a / divisor; [a, divisor] = [divisor, a % divisor]; [coefficient, next] = [next, coefficient - quotient * next]; }
  return mod(coefficient, b);
};
export function chooseOwnedAudioFrame(grids, earliest, latest) {
  if (!Array.isArray(grids) || grids.length > 1024 || !Number.isSafeInteger(earliest) || earliest < 0 || !Number.isSafeInteger(latest) || latest < earliest) fail();
  let residue = 0n, period = 1n;
  for (const grid of grids) {
    if (!Number.isSafeInteger(grid?.frame) || grid.frame < 0 || !Number.isSafeInteger(grid.frames) || grid.frames < 1 || grid.frames > 1048576) fail();
    const size = BigInt(grid.frames), value = mod(BigInt(grid.frame), size), shared = gcd(period, size), difference = value - residue;
    if (difference % shared) fail();
    const reduced = size / shared, step = reduced === 1n ? 0n : mod(difference / shared * inverse(period / shared, reduced), reduced);
    residue += period * step; period *= reduced; residue = mod(residue, period);
  }
  const minimum = BigInt(earliest), result = residue >= minimum ? residue : residue + (minimum - residue + period - 1n) / period * period;
  if (result > BigInt(latest)) fail();
  return Number(result);
}
