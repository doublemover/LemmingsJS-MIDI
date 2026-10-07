const GAME_SPEED_DETENTS = Object.freeze([
  ...Array.from({ length: 10 }, (_, index) => (index + 1) / 10),
  ...Array.from({ length: 9 }, (_, index) => index + 2),
  ...Array.from({ length: 11 }, (_, index) => (index + 2) * 10)
]);
const gameSpeedDetentIndex = speed => GAME_SPEED_DETENTS.reduce((closest, value, index) =>
  Math.abs(value - speed) < Math.abs(GAME_SPEED_DETENTS[closest] - speed) ? index : closest, 0);
const gameSpeedFromDetent = index => GAME_SPEED_DETENTS[Math.max(0, Math.min(GAME_SPEED_DETENTS.length - 1, Math.round(Number(index) || 0)))];
export { GAME_SPEED_DETENTS, gameSpeedDetentIndex, gameSpeedFromDetent };
