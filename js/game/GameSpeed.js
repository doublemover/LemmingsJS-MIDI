const GAME_SPEED_DETENTS = Object.freeze([
  ...Array.from({ length: 9 }, (_, index) => (index + 1) / 10),
  ...Array.from({ length: 10 }, (_, index) => index + 1),
  ...Array.from({ length: 11 }, (_, index) => (index + 2) * 10)
]);
const nextGameSpeed = (speed, direction) => {
  const current = Number.isFinite(speed) ? speed : 1;
  return direction > 0
    ? GAME_SPEED_DETENTS.find(value => value > current + 0.000001) ?? GAME_SPEED_DETENTS.at(-1)
    : [...GAME_SPEED_DETENTS].reverse().find(value => value < current - 0.000001) ?? GAME_SPEED_DETENTS[0];
};
const gameSpeedDetentIndex = speed => GAME_SPEED_DETENTS.reduce((closest, value, index) =>
  Math.abs(value - speed) < Math.abs(GAME_SPEED_DETENTS[closest] - speed) ? index : closest, 0);

const gameSpeedFromDetent = index => GAME_SPEED_DETENTS[Math.max(0, Math.min(GAME_SPEED_DETENTS.length - 1, Math.round(Number(index) || 0)))];
export { GAME_SPEED_DETENTS, nextGameSpeed, gameSpeedDetentIndex, gameSpeedFromDetent };
