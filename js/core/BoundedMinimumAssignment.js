export function assignBoundedMinimumCosts(costs, rows, columns, fail = message => { throw new RangeError(message); }) {
  if (!(costs instanceof Float64Array) || !Number.isInteger(rows) || rows < 1 || rows > 32 || !Number.isInteger(columns) || columns < rows || columns > 186 || costs.length !== rows * columns || costs.some(value => !Number.isFinite(value) || value < 0 || value > 2)) fail('Mode assignment exceeds its bounded finite cost matrix.');
  const u = new Float64Array(rows + 1), v = new Float64Array(columns + 1), p = new Uint16Array(columns + 1), way = new Uint16Array(columns + 1), minimum = new Float64Array(columns + 1), used = new Uint8Array(columns + 1);
  for (let row = 1; row <= rows; row++) {
    p[0] = row; minimum.fill(Infinity); used.fill(0); let column = 0;
    do {
      used[column] = 1; const active = p[column]; let delta = Infinity, next = 0;
      for (let candidate = 1; candidate <= columns; candidate++) if (!used[candidate]) { const cost = costs[(active - 1) * columns + candidate - 1] - u[active] - v[candidate]; if (cost < minimum[candidate]) { minimum[candidate] = cost; way[candidate] = column; } if (minimum[candidate] < delta) { delta = minimum[candidate]; next = candidate; } }
      if (!Number.isFinite(delta) || !next) fail('The modal assignment has no finite augmenting path.');
      for (let candidate = 0; candidate <= columns; candidate++) if (used[candidate]) { u[p[candidate]] += delta; v[candidate] -= delta; } else minimum[candidate] -= delta;
      column = next;
    } while (p[column]);
    do { const previous = way[column]; p[column] = p[previous]; column = previous; } while (column);
  }
  const result = new Uint16Array(rows); for (let column = 1; column <= columns; column++) if (p[column]) result[p[column] - 1] = column - 1; return result;
}
