const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set(['trap', 'water', 'lethal', 'exit', 'decor']);
const SIDES = new Set(['top', 'bottom', 'left', 'right', 'overlap']);
const packName = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const frame = image => image?.frames?.[image.preview_image_index ?? image.firstFrameIndex ?? 0] || image?.frames?.[0];

const validateAuthoredAssemblyCatalogs = catalogs => {
  if (!Array.isArray(catalogs) || catalogs.length > 256) throw new TypeError('Unbounded authored assembly catalogs');
  const scopes = new Set();
  for (const catalog of catalogs) {
    const key = catalog?.pack + '/' + catalog?.groundSet;
    if (!catalog || typeof catalog.pack !== 'string' || !catalog.pack || !integer(catalog.groundSet, 0, 15) ||
      ![catalog.assetSha256, catalog.objectSha256, catalog.sourceRevision].every(value => HASH.test(value)) || scopes.has(key)) throw new TypeError('Invalid authored assembly scope');
    scopes.add(key);
    if (!Array.isArray(catalog.sourceLevelIds) || !catalog.sourceLevelIds.length || catalog.sourceLevelIds.length > 4096 || new Set(catalog.sourceLevelIds).size !== catalog.sourceLevelIds.length ||
      catalog.sourceLevelIds.some(id => typeof id !== 'string' || !id.startsWith(catalog.pack + '/') || !/^(?:LEVEL|DLVEL)\d+\.DAT#\d+$/i.test(id.slice(catalog.pack.length + 1)))) throw new TypeError('Invalid authored assembly source levels');
    if (!Array.isArray(catalog.assetUsage) || catalog.assetUsage.length > 272 || !Array.isArray(catalog.associatedTerrainIds) || catalog.associatedTerrainIds.length > 256 || !Array.isArray(catalog.associatedObjectIds) || catalog.associatedObjectIds.length > 16) throw new TypeError('Unbounded authored component evidence');
    if (!Array.isArray(catalog.entries) || catalog.entries.length > 128 || !Array.isArray(catalog.unsupportedObjects) || catalog.unsupportedObjects.length > 32) throw new TypeError('Unbounded authored assembly entries');
    for (const use of catalog.assetUsage) if (!['terrain', 'object'].includes(use.kind) || !integer(use.id, 0, use.kind === 'terrain' ? 255 : 15) ||
      !integer(use.sourceUses, 1, 16777216) || !integer(use.linkedUses, 0, use.sourceUses) || !integer(use.intrinsicUses, 0, use.linkedUses) ||
      use.attachmentUseShare !== use.linkedUses / use.sourceUses || use.intrinsicUseShare !== use.intrinsicUses / use.sourceUses || !Array.isArray(use.transforms) || use.transforms.length > 4 ||
      use.associated !== (use.intrinsicUseShare >= 0.6 && use.stableTransforms > 0)) throw new TypeError('Invalid authored component usage');
    if (catalog.associatedTerrainIds.some(id => !catalog.assetUsage.some(a => a.kind === 'terrain' && a.id === id && a.associated)) ||
      catalog.associatedObjectIds.some(id => !integer(id, 0, 15))) throw new TypeError('Invalid authored component quarantine');
    const sources = new Set(catalog.sourceLevelIds), identities = new Set();
    for (const entry of catalog.entries) {
      if (typeof entry.id !== 'string' || !entry.id.startsWith(key + '/') || identities.has(entry.id) || !integer(entry.width, 1, 256) || !integer(entry.height, 1, 160) ||
        !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1 || typeof entry.eligible !== 'boolean' || !['terrain-contact', 'object-contact', 'internal-only'].includes(entry.supportClass) ||
        !Array.isArray(entry.placements) || entry.placements.length < 2 || entry.placements.length > 8 || !Array.isArray(entry.relations) || !entry.relations.length || entry.relations.length > 28 ||
        !Array.isArray(entry.supportAnchors) || entry.supportAnchors.length > 4 || !Array.isArray(entry.attachments) || entry.attachments.length > 28 || !Array.isArray(entry.sources) || !entry.sources.length || entry.sources.length > 4) throw new TypeError('Invalid authored assembly');
      identities.add(entry.id);
      const member = value => integer(value, 0, entry.placements.length - 1);
      for (const p of entry.placements) if (!['terrain', 'object'].includes(p.kind) || !integer(p.id, 0, p.kind === 'object' ? 15 : 255) ||
        p.kind === 'object' && !ROLES.has(p.role) || !integer(p.x, 0, entry.width - 1) || !integer(p.y, 0, entry.height - 1) || !integer(p.f, 0, 31)) throw new TypeError('Invalid authored assembly placement');
      const connected = new Set([0]);
      for (const edge of entry.relations) {
        if (!member(edge.a) || !member(edge.b) || edge.a === edge.b || !['contact', 'overlap'].includes(edge.type) || !SIDES.has(edge.side) ||
          !integer(edge.dx, -256, 256) || !integer(edge.dy, -160, 160) || !integer(edge.contactPixels, 1, 40960) || !integer(edge.overlapPixels, 0, edge.contactPixels) ||
          ![edge.x, edge.anchorX].every(x => integer(x, 0, entry.width - 1)) || ![edge.y, edge.anchorY].every(y => integer(y, 0, entry.height - 1))) throw new TypeError('Invalid authored alpha relation');
      }
      for (let pass = 0; pass < 8; pass++) for (const edge of entry.relations) if (connected.has(edge.a) || connected.has(edge.b)) { connected.add(edge.a); connected.add(edge.b); }
      if (connected.size !== entry.placements.length) throw new TypeError('Disconnected authored assembly');
      for (const attachment of entry.attachments) if (!member(attachment.member) || !member(attachment.anchorMember) || attachment.member === attachment.anchorMember ||
        entry.placements[attachment.member].kind !== 'object' || !SIDES.has(attachment.side) || !integer(attachment.contactPixels, 1, 40960) ||
        ![attachment.x, attachment.anchorX].every(x => integer(x, 0, entry.width - 1)) || ![attachment.y, attachment.anchorY].every(y => integer(y, 0, entry.height - 1))) throw new TypeError('Invalid authored attachment');
      for (const anchor of entry.supportAnchors) if (!member(anchor.member) || !SIDES.has(anchor.side) || !sources.has(anchor.source?.level) ||
        ![anchor.x, anchor.anchorX].every(x => integer(x, -256, 512)) || ![anchor.y, anchor.anchorY].every(y => integer(y, -160, 320)) ||
        !['terrain', 'object'].includes(anchor.anchor?.kind) || !integer(anchor.anchor.id, 0, anchor.anchor.kind === 'object' ? 15 : 255) ||
        !integer(anchor.anchor.x, -256, 512) || !integer(anchor.anchor.y, -160, 320) || !integer(anchor.anchor.f, 0, 31) ||
        !Number.isFinite(anchor.confidence) || anchor.confidence < 0 || anchor.confidence > 1 || !integer(anchor.evidence?.instances, 1, 16777216) || !integer(anchor.evidence?.levels, 1, catalog.sourceLevelIds.length)) throw new TypeError('Invalid authored external support anchor');
      for (const source of entry.sources) if (!sources.has(source.level) || !Array.isArray(source.terrainIndices) || !Array.isArray(source.objectIndices) || source.terrainIndices.length + source.objectIndices.length !== entry.placements.length ||
        source.terrainIndices.some(index => !integer(index, 0, 4095)) || source.objectIndices.some(index => !integer(index, 0, 31))) throw new TypeError('Invalid authored attachment provenance');
      if (!integer(entry.evidence?.instances, 1, 16777216) || !integer(entry.evidence?.levels, 1, catalog.sourceLevelIds.length) || entry.evidence.levels > entry.evidence.instances ||
        entry.eligible && (entry.confidence < 0.8 || entry.placements.some((p, index) => p.f & 1 || p.kind === 'terrain' && p.f & 20 || p.kind === 'object' && !entry.attachments.some(a => a.member === index)))) throw new TypeError('Invalid authored confidence eligibility');
      if (entry.repeat && (!integer(entry.repeat.dx, -256, 256) || !integer(entry.repeat.dy, -160, 160) || !entry.repeat.dx && !entry.repeat.dy || !integer(entry.repeat.observed, 3, 8))) throw new TypeError('Invalid authored repeat');
      if (entry.endcap && (!member(entry.endcap.member) || !entry.repeat || !['start', 'end'].includes(entry.endcap.side))) throw new TypeError('Invalid authored endcap');
    }
  }
  return catalogs;
};

const selectAuthoredAssemblyCatalog = (book, { packPath = '', groundSet = 0, assetSha256 = null, objectSha256 = null, sourceRevision = null } = {}) => {
  if (!HASH.test(assetSha256) || !HASH.test(objectSha256)) return null;
  const pack = packName(packPath);
  return (book?.assemblies || []).find(catalog => catalog.pack === pack && catalog.groundSet === groundSet && catalog.assetSha256 === assetSha256 &&
    catalog.objectSha256 === objectSha256 && (!sourceRevision || catalog.sourceRevision === sourceRevision)) || null;
};
const objectFingerprintChunks = images => {
  if (!Array.isArray(images) || images.length > 16) throw new RangeError('Object art fingerprint exceeds bounds');
  const encoder = new TextEncoder(), chunks = []; let size = 0;
  const add = bytes => { size += bytes.byteLength; if (size > 4000000) throw new RangeError('Object art bytes exceed bounds'); chunks.push(bytes); };
  for (const image of images) {
    add(encoder.encode(JSON.stringify([image.width, image.height, image.trigger_effect_id, image.trigger_left, image.trigger_top,
      image.trigger_width, image.trigger_height, image.preview_image_index])));
    if ((image.frames?.length || 0) > 64) throw new RangeError('Object animation frames exceed bounds');
    for (const frame of image.frames || []) add(Uint8Array.from(frame));
    add(new Uint8Array(image.palette.data.buffer));
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
};
const fingerprintObjectImages = async images => {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', objectFingerprintChunks(images));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};
const pieceMap = pieces => pieces instanceof Map ? pieces : new Map((pieces || []).filter(Boolean).map((piece, index) => [piece.id ?? index, piece]));
const compileAuthoredAssemblies = (catalog, terrainPieces, objectPieces, { minConfidence = 0.8, maxWidth = 112, maxHeight = 94 } = {}) => {
  if (!catalog) return [];
  validateAuthoredAssemblyCatalogs([catalog]);
  const terrain = pieceMap(terrainPieces), objects = pieceMap(objectPieces), result = [];
  for (const entry of catalog.entries) {
    if (!entry.eligible || entry.confidence < minConfidence || entry.width > maxWidth || entry.height > maxHeight) continue;
    const members = entry.placements.map(placement => {
      const piece = (placement.kind === 'terrain' ? terrain : objects).get(placement.id);
      const image = piece?.image || piece, pixels = piece?.frame || frame(image);
      return piece && pixels && image.width && image.height && pixels.length === image.width * image.height ? { ...placement, piece, image, pixels,
        collision: placement.kind === 'terrain', orientation: { flipX: !!(placement.f & 8), flipY: !!(placement.f & 2) } } : null;
    });
    if (members.some(member => !member || member.x + member.image.width > entry.width || member.y + member.image.height > entry.height || member.kind === 'terrain' && member.image.isSteel)) continue;
    const solid = (member, x, y) => {
      const dx = x - member.x, dy = y - member.y;
      if (!integer(dx, 0, member.image.width - 1) || !integer(dy, 0, member.image.height - 1)) return false;
      return !(member.pixels[(member.orientation.flipY ? member.image.height - dy - 1 : dy) * member.image.width + (member.orientation.flipX ? member.image.width - dx - 1 : dx)] & 128);
    };
    if (entry.attachments.some(a => !solid(members[a.member], a.x, a.y) || !solid(members[a.anchorMember], a.anchorX, a.anchorY))) continue;
    const supportAnchors = entry.supportAnchors.map(a => {
      const piece = (a.anchor.kind === 'terrain' ? terrain : objects).get(a.anchor.id), image = piece?.image || piece;
      const pixels = piece?.frame || frame(image);
      if (!piece || !pixels || !image.width || !image.height || pixels.length !== image.width * image.height || a.anchor.kind === 'terrain' && image.isSteel) return null;
      const anchor = { ...a.anchor, piece, image, pixels, collision: a.anchor.kind === 'terrain',
        orientation: { flipX: !!(a.anchor.f & 8), flipY: !!(a.anchor.f & 2) } };
      return solid(members[a.member], a.x, a.y) && solid(anchor, a.anchorX, a.anchorY) ? { ...a, anchor } : null;
    }).filter(Boolean);
    result.push({ entry, members, terrain: members.filter(member => member.collision), objects: members.filter(member => !member.collision),
      attachments: entry.attachments.map(a => ({ ...a })), supportAnchors, sourceRevision: catalog.sourceRevision, requiresExternalSupport: true });
  }
  return result;
};

export { validateAuthoredAssemblyCatalogs, selectAuthoredAssemblyCatalog, compileAuthoredAssemblies, fingerprintObjectImages };
