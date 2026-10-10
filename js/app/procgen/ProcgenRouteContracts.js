import { assertSolverSnapshotSize } from '../../solver/SolverState.js';

const INVENTORY_KEYS = ['builder', 'basher', 'digger', 'miner'];
const REQUIRED_GUARDS = ['ordinary-whole-crew', 'zero-loss', 'protected-terrain', 'revealed-geometry'];
const inside = (point, rect) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
const rect = (value, name) => {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(value[key])) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) throw new TypeError('Invalid route contract ' + name);
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
};
const fits = (child, parent) => inside(child, parent) && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height;

const createProcgenRouteContract = input => {
  if (input?.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1) throw new TypeError('Invalid route contract identity');
  const source = input.source;
  if (!source || !['repo-fixture', 'catalogue'].includes(source.kind) || typeof source.reference !== 'string' || !source.reference || typeof source.engine !== 'string' || !source.engine || typeof source.port !== 'string' || !source.port || source.assetSha256 != null && !/^[a-f0-9]{64}$/.test(source.assetSha256)) throw new TypeError('Invalid route contract provenance');
  const bounds = rect(input.geometry?.bounds, 'bounds'), entry = rect(input.geometry?.entry, 'entry'), exit = rect(input.geometry?.exit, 'exit');
  assertSolverSnapshotSize(bounds.width, bounds.height, { maxSnapshotPixels: 131072 });
  const containment = (input.geometry.containment || []).map(value => rect(value, 'containment'));
  if (containment.length > 8 || ![entry, exit, ...containment].every(value => fits(value, bounds))) throw new RangeError('Route contract geometry must fit bounded source geometry');
  const inventory = input.inventory;
  if (!inventory || Object.keys(inventory).length !== INVENTORY_KEYS.length || !INVENTORY_KEYS.every(key => Number.isSafeInteger(inventory[key]) && inventory[key] >= 0 && inventory[key] <= 64)) throw new TypeError('Route contract requires one complete jointly feasible inventory');
  if (!Array.isArray(input.guards) || input.guards.length > 8 || !REQUIRED_GUARDS.every(guard => input.guards.includes(guard)) || input.guards.some(guard => ![...REQUIRED_GUARDS, 'solid-containment', 'no-hazard-contacts'].includes(guard)) || input.guards.includes('solid-containment') && !containment.length) throw new TypeError('Route contract requires explicit supported whole-crew guards');
  const crew = input.crew;
  if (!crew || !Number.isSafeInteger(crew.min) || !Number.isSafeInteger(crew.max) || crew.min < 1 || crew.max < crew.min || crew.max > 64 || ![1, -1].includes(crew.direction)) throw new TypeError('Invalid route contract crew entry state');
  if (!Array.isArray(input.actionRules) || input.actionRules.length > 16) throw new TypeError('Invalid route contract action rules');
  const remaining = { ...inventory }, rules = input.actionRules.map((rule, index) => {
    if (!INVENTORY_KEYS.includes(rule.skill) || --remaining[rule.skill] < 0 || !Array.isArray(rule.window) || rule.window.length !== 2 || !rule.window.every(tick => Number.isSafeInteger(tick) && tick >= 0 && tick <= 4096) || rule.window[0] > rule.window[1] || index > 0 && rule.window[0] < input.actionRules[index - 1].window[0] || typeof rule.reason !== 'string' || !rule.reason) throw new TypeError('Invalid ordered joint-inventory action rule');
    return Object.freeze({ skill: rule.skill, window: Object.freeze([...rule.window]), reason: rule.reason });
  });
  if (!Array.isArray(input.failureCases) || input.failureCases.length < 1 || input.failureCases.length > 16 || input.failureCases.some(value => typeof value !== 'string' || !value)) throw new TypeError('Route contract requires bounded explicit failure cases');
  if (source.assetSha256 && (typeof source.pack !== 'string' || !source.pack || !Number.isInteger(source.groundSet) || source.groundSet < 0 || source.groundSet > 15)) throw new TypeError('Route art provenance requires an exact pack/ground scope');
  return Object.freeze({ schemaVersion: 1, id: input.id, version: input.version, source: Object.freeze({ ...source }),
    geometry: Object.freeze({ bounds, entry, exit, containment: Object.freeze(containment) }), inventory: Object.freeze({ ...inventory }),
    guards: Object.freeze([...input.guards]), crew: Object.freeze({ ...crew }), actionRules: Object.freeze(rules), failureCases: Object.freeze([...input.failureCases]) });
};
const validateProcgenRouteCatalogue = records => {
  if (!Array.isArray(records) || records.length > 64) throw new TypeError('Unbounded procgen route catalogue');
  const seen = new Set();
  return records.map(record => {
    const contract = createProcgenRouteContract(record), key = contract.id + '@' + contract.version;
    if (seen.has(key)) throw new TypeError('Duplicate procgen route contract'); seen.add(key); return contract;
  });
};

const selectProcgenRouteContracts = (book, { packPath = '', groundSet = 0, assetSha256 = null } = {}) => {
  if (!/^[a-f0-9]{64}$/.test(assetSha256 || '')) return [];
  const pack = String(packPath).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  return (book?.routeContracts || []).filter(record => record.source?.kind === 'catalogue' && record.source.pack === pack && record.source.groundSet === groundSet && record.source.assetSha256 === assetSha256).map(createProcgenRouteContract);
};
export { createProcgenRouteContract, validateProcgenRouteCatalogue, selectProcgenRouteContracts };
