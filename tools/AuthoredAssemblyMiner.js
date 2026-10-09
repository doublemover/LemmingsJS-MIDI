import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { createHash } from 'node:crypto';
import { ERASE, NO_OVERWRITE, ONLY_OVERWRITE, FLIP_X, FLIP_Y } from '../js/app/procgen/ProcgenTerrainRecipes.js';

const LIMITS = Object.freeze({ scopes: 256, levels: 4096, members: 8, candidates: 4096, retained: 64,
  width: 256, height: 160, placements: 4096, objects: 32, comparisons: 65536, alphaChecks: 400000, sources: 4 });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (level, configs) => level.format === 'classic-dat' && configs.has(level.pack) && level.aliases?.length && !level.generated &&
  !level.graphicSet2 && level.id?.startsWith(level.pack + '/') && /^(?:LEVEL|DLVEL)\d+\.DAT#\d+$/i.test(level.id.slice(level.pack.length + 1));
const imageFrame = image => image?.frames?.[image.preview_image_index ?? image.firstFrameIndex ?? 0] || image?.frames?.[0];
const pixel = (node, x, y) => {
  const dx = x - node.x, dy = y - node.y, image = node.image;
  if (dx < 0 || dy < 0 || dx >= image.width || dy >= image.height) return false;
  return !(node.frame[(node.f & FLIP_Y ? image.height - dy - 1 : dy) * image.width + (node.f & FLIP_X ? image.width - dx - 1 : dx)] & 128);
};
const relation = (a, b, budget) => {
  const left = Math.max(a.x - 1, b.x - 1), right = Math.min(a.x + a.image.width + 1, b.x + b.image.width + 1);
  const top = Math.max(a.y - 1, b.y - 1), bottom = Math.min(a.y + a.image.height + 1, b.y + b.image.height + 1);
  if (left >= right || top >= bottom) return null;
  let contactPixels = 0, overlapPixels = 0, anchor = null;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (++budget.checks > LIMITS.alphaChecks) return null;
    if (!pixel(a, x, y)) continue;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) if (pixel(b, x + dx, y + dy)) {
      contactPixels++; if (!dx && !dy) overlapPixels++;
      if (!anchor || !overlapPixels && anchor.side === 'overlap') anchor = { x, y, anchorX: x + dx, anchorY: y + dy,
        side: !dx && !dy ? 'overlap' : dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'top' : 'bottom' };
      break;
    }
  }
  return contactPixels ? { type: overlapPixels ? 'overlap' : 'contact', contactPixels, overlapPixels, ...anchor } : null;
};
const role = image => image?.trigger_effect_id === TriggerTypes.TRAP ? 'trap' : image?.trigger_effect_id === TriggerTypes.DROWN ? 'water' :
  [TriggerTypes.KILL, TriggerTypes.FRYING].includes(image?.trigger_effect_id) ? 'lethal' : image?.trigger_effect_id === TriggerTypes.EXIT_LEVEL ? 'exit' : 'decor';
const hazard = node => node.kind === 'object' && ['trap', 'water', 'lethal'].includes(role(node.image));
const reverseSide = side => side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : side === 'right' ? 'left' : 'overlap';
const bounds = nodes => ({ x: Math.min(...nodes.map(node => node.x)), y: Math.min(...nodes.map(node => node.y)),
  right: Math.max(...nodes.map(node => node.x + node.image.width)), bottom: Math.max(...nodes.map(node => node.y + node.image.height)) });
const rank = values => [...values].sort((a, b) => b.levels.size - a.levels.size || b.instances - a.instances || b.contactPixels - a.contactPixels || a.key.localeCompare(b.key));

/** Learns small exact assemblies from configured authored geometry; no whole-level or online learning. */
const createAuthoredAssemblyMiner = (configs = []) => {
  const configHashes = new Map(configs.map(config => [config.path, digest(config)])), scopes = new Map();
  const observe = (level, art) => {
    if (!canonical(level, configHashes)) return;
    if (level.placements.length > LIMITS.placements || (level.objects?.length || 0) > LIMITS.objects || level.width > 4096 || level.height > 4096) throw new RangeError('Authored assembly scan exceeds bounds');
    const identity = level.pack + '/' + level.groundSet;
    let scope = scopes.get(identity);
    if (!scope) {
      if (scopes.size >= LIMITS.scopes) throw new RangeError('Authored assembly scope bound exceeded');
      scope = { pack: level.pack, groundSet: level.groundSet, assetSha256: art.assetSha256, objectSha256: art.objectSha256,
        levels: new Map(), patterns: new Map(), uses: new Map(), associations: new Map(), omitted: 0, alphaOmitted: 0, unsupported: new Map() }; scopes.set(identity, scope);
    }
    if (scope.assetSha256 !== art.assetSha256 || scope.objectSha256 !== art.objectSha256) throw new Error('Authored assembly source art changed within scope');
    if (scope.levels.has(level.id)) return;
    if (scope.levels.size >= LIMITS.levels) throw new RangeError('Authored assembly level bound exceeded');
    scope.levels.set(level.id, level.sha256);
    for (const [kind, placements] of [['terrain', level.placements], ['object', level.objects || []]]) for (const p of placements) {
      const key = kind + '/' + p.id;
      if (!scope.uses.has(key)) scope.uses.set(key, { kind, id: p.id, sourceUses: 0, linked: new Set(), intrinsic: new Set(), levels: new Set() });
      const use = scope.uses.get(key); use.sourceUses++; use.levels.add(level.id);
    }
    const make = (p, index, kind, images) => {
      const image = images[p.id], frame = imageFrame(image);
      return image?.width && image?.height && frame && frame.length === image.width * image.height && image.width <= LIMITS.width && image.height <= LIMITS.height ?
        { ...p, index, kind, image, frame, serial: 0 } : null;
    };
    const nodes = [...level.placements.map((p, index) => make(p, index, 'terrain', art.terrain)),
      ...(level.objects || []).map((p, index) => make(p, index, 'object', art.objects))].filter(Boolean);
    nodes.forEach((node, serial) => { node.serial = serial; });
    const grid = new Map(), cell = 32;
    const cells = (node, margin = 0) => {
      const result = [];
      for (let y = Math.floor((node.y - margin) / cell); y <= Math.floor((node.y + node.image.height - 1 + margin) / cell); y++) {
        for (let x = Math.floor((node.x - margin) / cell); x <= Math.floor((node.x + node.image.width - 1 + margin) / cell); x++) result.push(x + '/' + y);
      }
      return result;
    };
    for (const node of nodes) for (const key of cells(node)) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(node); }
    const relations = new Map(), neighbours = new Map(), pairs = new Set(), budget = { checks: 0 }, observed = new Set();
    const record = (group, edges, extra = {}) => {
      const independentObjects = group.every(node => node.kind === 'object') && edges.every(edge => !edge.overlapPixels);
      const ordered = [...group].sort((a, b) => (a.kind === 'terrain' ? 0 : 1) - (b.kind === 'terrain' ? 0 : 1) || (independentObjects ? a.id - b.id : 0) || a.index - b.index);
      if (extra.endcap) extra = { ...extra, endcap: { ...extra.endcap, member: ordered.findIndex(node => node.serial === extra.endcap.member) } };
      const box = bounds(ordered), width = box.right - box.x, height = box.bottom - box.y;
      if (ordered.length > LIMITS.members || width > LIMITS.width || height > LIMITS.height) return;
      const members = ordered.map(node => ({ kind: node.kind, id: node.id, x: node.x - box.x, y: node.y - box.y, f: node.f, ...(node.kind === 'object' ? { role: role(node.image) } : {}) }));
      const localRelations = edges.map(edge => ({ a: ordered.indexOf(edge.a), b: ordered.indexOf(edge.b), dx: edge.b.x - edge.a.x, dy: edge.b.y - edge.a.y,
        type: edge.type, contactPixels: edge.contactPixels, overlapPixels: edge.overlapPixels,
        x: edge.x - box.x, y: edge.y - box.y, anchorX: edge.anchorX - box.x, anchorY: edge.anchorY - box.y, side: edge.side }));
      const key = JSON.stringify([members, extra.repeat || null, extra.endcap || null]);
      const instance = key + '/' + ordered.map(node => node.kind + ':' + node.index).join(',');
      if (observed.has(instance)) return; observed.add(instance);
      let pattern = scope.patterns.get(key);
      if (!pattern) {
        if (scope.patterns.size >= LIMITS.candidates) { scope.omitted++; return; }
        pattern = { key, placements: members, relations: localRelations, width, height, ...extra, levels: new Set(), instances: 0,
          contactPixels: edges.reduce((count, edge) => count + edge.contactPixels, 0), sources: [], supports: new Map() }; scope.patterns.set(key, pattern);
      }
      pattern.instances++; pattern.levels.add(level.id);
      for (const node of ordered) for (const link of neighbours.get(node) || []) {
        if (ordered.includes(link.other) || link.other.f & (ERASE | NO_OVERWRITE | ONLY_OVERWRITE)) continue;
        const edge = link.edge, forward = edge.a === node;
        const support = { member: ordered.indexOf(node), x: (forward ? edge.x : edge.anchorX) - box.x,
          y: (forward ? edge.y : edge.anchorY) - box.y, anchorX: (forward ? edge.anchorX : edge.x) - box.x,
          anchorY: (forward ? edge.anchorY : edge.y) - box.y,
          anchor: { kind: link.other.kind, id: link.other.id, x: link.other.x - box.x, y: link.other.y - box.y, f: link.other.f },
          side: forward ? edge.side : edge.side === 'top' ? 'bottom' : edge.side === 'bottom' ? 'top' : edge.side === 'left' ? 'right' : edge.side === 'right' ? 'left' : 'overlap' };
        const supportKey = JSON.stringify(support);
        let measured = pattern.supports.get(supportKey);
        if (!measured && pattern.supports.size < 8) { measured = { ...support, instances: 0, instancesSeen: new Set(), levels: new Set(), source: { level: level.id,
          kind: link.other.kind, index: link.other.index } }; pattern.supports.set(supportKey, measured); }
        if (measured) { measured.instances++; measured.instancesSeen.add(level.id + '/' + ordered.map(n => n.kind + ':' + n.index).join(',')); measured.levels.add(level.id); }
      }
      if (pattern.sources.length < LIMITS.sources && !pattern.sources.some(source => source.level === level.id)) pattern.sources.push({ level: level.id,
        terrainIndices: ordered.filter(node => node.kind === 'terrain').map(node => node.index), objectIndices: ordered.filter(node => node.kind === 'object').map(node => node.index) });
    };
    let comparisons = 0;
    const scanOrder = [...nodes].sort((a, b) => (b.kind === 'object') - (a.kind === 'object') || a.serial - b.serial);
    for (const a of scanOrder) {
      const near = new Map();
      for (const key of cells(a, 1)) for (const b of grid.get(key) || []) if (b !== a) near.set(b.serial, b);
      for (const b of [...near.values()].sort((p, q) => p.serial - q.serial)) {
        const key = Math.min(a.serial, b.serial) + '/' + Math.max(a.serial, b.serial);
        if (pairs.has(key)) continue; pairs.add(key);
        if (++comparisons > LIMITS.comparisons || budget.checks >= LIMITS.alphaChecks) { scope.alphaOmitted++; break; }
        if ((a.f | b.f) & ERASE) continue;
        const contact = relation(a, b, budget); if (!contact) continue;
        const edge = { a, b, ...contact }; relations.set(key, edge);
        for (const [head, part] of [[a, b], [b, a]]) if (hazard(head)) {
          const use = scope.uses.get(part.kind + '/' + part.id), uid = level.id + '/' + part.index;
          use.linked.add(uid);
          const side = head === a ? contact.side : reverseSide(contact.side);
          const intrinsic = part.kind === 'object' ? role(part.image) === 'decor' : side !== 'bottom' &&
            (side !== 'overlap' || contact.overlapPixels >= Math.max(2, head.image.width * head.image.height * 0.05));
          if (intrinsic) use.intrinsic.add(uid);
          const associationKey = JSON.stringify([head.id, head.f, part.kind, part.id, part.f, part.x - head.x, part.y - head.y]);
          let association = scope.associations.get(associationKey);
          if (!association && scope.associations.size < LIMITS.candidates) {
            association = { headId: head.id, partKind: part.kind, partId: part.id, dx: part.x - head.x, dy: part.y - head.y,
              flags: [head.f, part.f], side, overlapPixels: contact.overlapPixels, contactPixels: contact.contactPixels, intrinsic,
              uses: new Set(), levels: new Set(), source: { level: level.id, headIndex: head.index, partIndex: part.index } };
            scope.associations.set(associationKey, association);
          }
          if (association) { association.uses.add(uid); association.levels.add(level.id); }
        }
        for (const [member, other] of [[a, b], [b, a]]) { if (!neighbours.has(member)) neighbours.set(member, []); neighbours.get(member).push({ other, edge }); }
      }
    }
    for (const edge of relations.values()) record([edge.a, edge.b], [edge]);
    const locations = new Map(nodes.map(node => [node.kind + '/' + node.id + '/' + node.f + '/' + node.x + '/' + node.y, node]));
    for (const node of scanOrder) {
      const adjacent = (neighbours.get(node) || []).sort((a, b) => b.edge.contactPixels - a.edge.contactPixels || a.other.serial - b.other.serial);
      if (!adjacent.length && node.kind === 'object') {
        const key = node.id + '/' + node.f; let unsupported = scope.unsupported.get(key);
        if (!unsupported) { unsupported = { id: node.id, f: node.f, role: role(node.image), reason: 'no-measured-alpha-attachment', instances: 0, source: { level: level.id, objectIndices: [node.index] } }; scope.unsupported.set(key, unsupported); }
        unsupported.instances++; continue;
      }
      if (adjacent.length >= 2) record([node, ...adjacent.slice(0, LIMITS.members - 1).map(item => item.other)], adjacent.slice(0, LIMITS.members - 1).map(item => item.edge));
      for (const item of adjacent) {
        const b = item.other, dx = b.x - node.x, dy = b.y - node.y;
        if (node.kind !== b.kind || node.id !== b.id || node.f !== b.f || !dx && !dy) continue;
        const c = locations.get(node.kind + '/' + node.id + '/' + node.f + '/' + (b.x + dx) + '/' + (b.y + dy));
        const next = c && (neighbours.get(b) || []).find(link => link.other === c);
        if (!next) continue;
        const chain = [node, b, c], edges = [item.edge, next.edge];
        record(chain, edges, { repeat: { dx, dy, observed: 3 } });
        const cap = adjacent.find(link => link.other.id !== node.id && !chain.includes(link.other));
        if (cap) record([...chain, cap.other], [...edges, cap.edge], { repeat: { dx, dy, observed: 3 }, endcap: { member: cap.other.serial, side: 'start' } });
      }
    }
  };
  const finish = () => [...scopes.values()].sort((a, b) => a.pack.localeCompare(b.pack) || a.groundSet - b.groundSet).map(scope => {
    const candidates = rank(scope.patterns.values()), retained = [], chosen = new Set();
    for (let id = 0; id < 16; id++) for (const candidate of candidates.filter(entry => entry.placements.some(p => p.kind === 'object' && p.id === id)).slice(0, 4)) {
      if (!chosen.has(candidate.key)) { chosen.add(candidate.key); retained.push(candidate); }
    }
    for (const candidate of candidates) if (retained.length < LIMITS.retained && !chosen.has(candidate.key)) { chosen.add(candidate.key); retained.push(candidate); }
    const sourceLevelIds = [...scope.levels.keys()], sourceRevision = digest({ config: configHashes.get(scope.pack),
      terrain: scope.assetSha256, objects: scope.objectSha256, levels: [...scope.levels], version: 1 });
    const assetUsage = [...scope.uses.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id).map(use => {
      const transforms = [...scope.associations.values()].filter(a => a.partKind === use.kind && a.partId === use.id);
      const repeatedIntrinsic = transforms.filter(a => a.intrinsic && a.uses.size >= 2);
      const share = use.intrinsic.size / Math.max(1, use.sourceUses);
      return { kind: use.kind, id: use.id, sourceUses: use.sourceUses, sourceLevels: use.levels.size, linkedUses: use.linked.size,
        attachmentUseShare: use.linked.size / Math.max(1, use.sourceUses), intrinsicUses: use.intrinsic.size, intrinsicUseShare: share,
        stableTransforms: repeatedIntrinsic.length, associated: share >= 0.6 && repeatedIntrinsic.length > 0,
        transforms: transforms.sort((a, b) => b.uses.size - a.uses.size || a.dx - b.dx || a.dy - b.dy).slice(0, 4).map(a => ({
          headId: a.headId, dx: a.dx, dy: a.dy, flags: a.flags, side: a.side, contactPixels: a.contactPixels, overlapPixels: a.overlapPixels,
          intrinsic: a.intrinsic, uses: a.uses.size, levels: a.levels.size, source: a.source })) };
    });
    const associatedTerrainIds = assetUsage.filter(a => a.kind === 'terrain' && a.associated).map(a => a.id);
    const associatedObjectIds = new Set(assetUsage.filter(a => a.kind === 'object' && a.associated).map(a => a.id));
    for (const a of scope.associations.values()) if (assetUsage.some(use => use.kind === a.partKind && use.id === a.partId && use.associated) && a.intrinsic && a.uses.size >= 2) associatedObjectIds.add(a.headId);
    const catalog = { pack: scope.pack, groundSet: scope.groundSet, assetSha256: scope.assetSha256, objectSha256: scope.objectSha256, sourceRevision,
      sourceLevelIds, assetUsage, associatedTerrainIds, associatedObjectIds: [...associatedObjectIds].sort((a, b) => a - b), limits: LIMITS, omittedCandidates: scope.omitted, omittedAlphaScans: scope.alphaOmitted,
      unsupportedObjects: [...scope.unsupported.values()].slice(0, 32), entries: retained.map(pattern => {
        const confidence = pattern.levels.size >= 2 ? 0.9 : pattern.instances >= 2 ? 0.8 : 0.55;
        const attachments = pattern.relations.flatMap(edge => {
          const attachments = [];
          if (pattern.placements[edge.a].kind === 'object') attachments.push({ member: edge.a, anchorMember: edge.b,
            x: edge.x, y: edge.y, anchorX: edge.anchorX, anchorY: edge.anchorY, side: edge.side, contactPixels: edge.contactPixels });
          if (pattern.placements[edge.b].kind === 'object') attachments.push({ member: edge.b, anchorMember: edge.a,
            x: edge.anchorX, y: edge.anchorY, anchorX: edge.x, anchorY: edge.y,
            side: edge.side === 'top' ? 'bottom' : edge.side === 'bottom' ? 'top' : edge.side === 'left' ? 'right' : edge.side === 'right' ? 'left' : 'overlap', contactPixels: edge.contactPixels });
          return attachments;
        });
        const supportAnchors = rank([...pattern.supports].map(([key, support]) => ({ ...support, key, contactPixels: 0 }))).slice(0, 4).map(support => ({
          member: support.member, x: support.x, y: support.y, anchorX: support.anchorX, anchorY: support.anchorY, anchor: support.anchor, side: support.side,
          ...(() => {
            const family = [...pattern.supports.values()].filter(a => a.member === support.member && a.anchor.kind === support.anchor.kind && a.anchor.id === support.anchor.id && a.anchor.f === support.anchor.f && a.side === support.side &&
              (['left', 'right'].includes(a.side) ? a.x === support.x : ['top', 'bottom'].includes(a.side) ? a.y === support.y : a.x === support.x && a.y === support.y));
            const familyInstances = new Set(family.flatMap(a => [...a.instancesSeen])).size, familyLevels = new Set(family.flatMap(a => [...a.levels])).size;
            return { confidence: support.levels.size >= 2 ? 0.9 : support.instances >= 2 || familyInstances >= 2 ? 0.8 : 0.55,
              confidenceBasis: support.instances >= 2 ? 'exact-transform-repeat' : familyInstances >= 2 ? 'repeated-attachment-family' : 'single-source-contact',
              evidence: { instances: support.instances, levels: support.levels.size, attachmentFamilyInstances: familyInstances, attachmentFamilyLevels: familyLevels } };
          })(), source: support.source }));
        const objectMembers = pattern.placements.map((p, index) => p.kind === 'object' ? index : -1).filter(index => index >= 0);
        return { id: scope.pack + '/' + scope.groundSet + '/' + digest(pattern.key).slice(0, 16), placements: pattern.placements,
          relations: pattern.relations, attachments, supportAnchors, supportClass: attachments.some(a => pattern.placements[a.anchorMember].kind === 'terrain') ? 'terrain-contact' : attachments.length ? 'object-contact' : 'internal-only',
          width: pattern.width, height: pattern.height, confidence, eligible: confidence >= 0.8 && !pattern.placements.some(p => p.kind === 'terrain' && p.f & (NO_OVERWRITE | ONLY_OVERWRITE)) && objectMembers.every(index => attachments.some(a => a.member === index)),
          evidence: { instances: pattern.instances, levels: pattern.levels.size, alpha: 'decoded-preview-frame', semantic: 'unlabeled-spatial-assembly' },
          ...(pattern.repeat ? { repeat: pattern.repeat } : {}), ...(pattern.endcap ? { endcap: pattern.endcap } : {}), sources: pattern.sources };
      }) };
    catalog.totals = { authoredLevels: sourceLevelIds.length, retainedEntries: catalog.entries.length,
      acceptedEntries: catalog.entries.filter(entry => entry.eligible).length, ambiguousEntries: catalog.entries.filter(entry => !entry.eligible).length,
      quarantinedTerrainIds: catalog.associatedTerrainIds.length, quarantinedObjectIds: catalog.associatedObjectIds.length,
      omittedCandidates: scope.omitted, omittedAlphaScans: scope.alphaOmitted };
    return catalog;
  });
  return { observe, finish };
};
export { createAuthoredAssemblyMiner, LIMITS as AUTHORED_ASSEMBLY_LIMITS };
