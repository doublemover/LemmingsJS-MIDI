export const compareSolverKeys = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function createSolverSearchFrontier(compare, maximum) {
  const values = [];
  return {
    get size() { return values.length; },
    push(value) {
      if (values.length >= maximum) return false;
      let index = values.length; values.push(value);
      while (index) { const parent = (index - 1) >> 1; if (compare(values[parent], value) <= 0) break; values[index] = values[parent]; index = parent; }
      values[index] = value; return true;
    },
    pop() {
      if (!values.length) return null;
      const first = values[0], last = values.pop(); if (!values.length) return first;
      let index = 0;
      while (index * 2 + 1 < values.length) {
        let child = index * 2 + 1; if (child + 1 < values.length && compare(values[child + 1], values[child]) < 0) child++;
        if (compare(last, values[child]) <= 0) break; values[index] = values[child]; index = child;
      }
      values[index] = last; return first;
    }
  };
}
