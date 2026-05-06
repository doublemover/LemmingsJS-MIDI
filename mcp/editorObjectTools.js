const createEditorObjectToolHandlers = ({
  schemas,
  getSession,
  getState,
  callE2E,
  attachEvents,
  nudgeWatchPolling
}) => {
  const {
    EditorApplySchema,
    ObjectsDeleteSchema,
    ObjectsListSchema,
    ObjectsPlaceSchema,
    ObjectsUpdateSchema
  } = schemas;

  const getEditorLevelFromState = (state) => state?.editor?.session?.level ?? null;

  const getEditorRevisionFromState = (state) => {
    const revision = state?.editor?.history?.cursor;
    return Number.isFinite(revision) ? Number(revision) : null;
  };

  const getEditorListByKind = (level, kind) => {
    if (!level) return null;
    if (kind === 'terrain') return Array.isArray(level.terrains) ? level.terrains : [];
    if (kind === 'gadget') return Array.isArray(level.gadgets) ? level.gadgets : [];
    if (kind === 'steel') return Array.isArray(level.steel) ? level.steel : [];
    return null;
  };

  const normalizeEditorBBox = (bbox) => {
    if (!bbox || !Number.isFinite(bbox.x) || !Number.isFinite(bbox.y)) return null;
    const width = Number.isFinite(bbox.width) ? bbox.width : bbox.w;
    const height = Number.isFinite(bbox.height) ? bbox.height : bbox.h;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return {
      x: Number(bbox.x),
      y: Number(bbox.y),
      width: Number(width),
      height: Number(height)
    };
  };

  const editorBoundsIntersect = (a, b) => (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );

  const getEditorObjectBounds = (entry, kind) => {
    const props = entry?.props || {};
    const x = Number.isFinite(props.X) ? props.X : (Number.isFinite(props.x) ? props.x : 0);
    const y = Number.isFinite(props.Y) ? props.Y : (Number.isFinite(props.y) ? props.y : 0);
    if (kind === 'steel') {
      const width = Number.isFinite(props.WIDTH) ? props.WIDTH : 1;
      const height = Number.isFinite(props.HEIGHT) ? props.HEIGHT : 1;
      return { x, y, width, height };
    }
    return { x, y, width: 1, height: 1 };
  };

  const buildEditorObjectId = (kind, index, entry) => (
    entry?.uid ? `${kind}:${entry.uid}` : `${kind}:#${index}`
  );

  const buildEditorObjectRecord = (kind, index, entry, fields = 'compact') => {
    const props = entry?.props || {};
    const bounds = getEditorObjectBounds(entry, kind);
    const record = {
      id: buildEditorObjectId(kind, index, entry),
      kind,
      index,
      uid: entry?.uid || null,
      piece: Number.isFinite(props.PIECE) ? props.PIECE : null,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    if (fields === 'full') {
      record.entry = entry ? JSON.parse(JSON.stringify(entry)) : null;
    }
    record._hash = JSON.stringify({
      uid: record.uid,
      index: record.index,
      props,
      order: Array.isArray(entry?.order) ? entry.order : []
    });
    return record;
  };

  const collectEditorObjectRecords = (level, kind, fields) => {
    const kinds = kind === 'all' ? ['terrain', 'gadget', 'steel'] : [kind];
    const records = [];
    for (const oneKind of kinds) {
      const list = getEditorListByKind(level, oneKind) || [];
      for (let index = 0; index < list.length; index += 1) {
        records.push(buildEditorObjectRecord(oneKind, index, list[index], fields));
      }
    }
    return records;
  };

  const resolveEditorObjectRef = (level, ref) => {
    const requestedKind = ref?.kind;
    const kinds = requestedKind && requestedKind !== 'all'
      ? [requestedKind]
      : ['terrain', 'gadget', 'steel'];
    if (Number.isFinite(ref?.index)) {
      if (!requestedKind || requestedKind === 'all') return null;
      const list = getEditorListByKind(level, requestedKind);
      const index = Math.trunc(ref.index);
      if (!list || index < 0 || index >= list.length) return null;
      const entry = list[index];
      return {
        kind: requestedKind,
        index,
        uid: entry?.uid || null
      };
    }
    if (typeof ref?.uid === 'string' && ref.uid) {
      for (const kind of kinds) {
        const list = getEditorListByKind(level, kind);
        if (!list) continue;
        const index = list.findIndex((entry) => entry?.uid === ref.uid);
        if (index >= 0) {
          return {
            kind,
            index,
            uid: ref.uid
          };
        }
      }
    }
    return null;
  };

  const cacheEditorListSnapshot = (session, queryKey, revision, records) => {
    if (!session.editorObjectListCache) {
      session.editorObjectListCache = new Map();
    }
    const map = new Map(records.map((record) => [record.id, record._hash]));
    session.editorObjectListCache.delete(queryKey);
    session.editorObjectListCache.set(queryKey, { revision, map });
    while (session.editorObjectListCache.size > 32) {
      const oldestKey = session.editorObjectListCache.keys().next().value;
      session.editorObjectListCache.delete(oldestKey);
    }
  };

  const buildEditorListDelta = (previous, current, sinceRevision, toRevision) => {
    if (!previous || previous.revision !== sinceRevision) {
      return {
        available: false,
        reason: 'stale_or_missing_revision',
        baseRevision: sinceRevision,
        toRevision
      };
    }
    const added = [];
    const removed = [];
    const updated = [];
    for (const [id, hash] of current.entries()) {
      if (!previous.map.has(id)) {
        added.push(id);
      } else if (previous.map.get(id) !== hash) {
        updated.push(id);
      }
    }
    for (const id of previous.map.keys()) {
      if (!current.has(id)) {
        removed.push(id);
      }
    }
    return {
      available: true,
      baseRevision: sinceRevision,
      toRevision,
      added,
      removed,
      updated
    };
  };

  const runEditorApply = async (session, ops, options = {}) => {
    const result = await callE2E(session, 'editorApply', ops || [], {
      atomic: options.atomic,
      dryRun: options.dryRun,
      history: options.history,
      preview: options.preview,
      validate: options.validate,
      returnState: options.returnState
    });
    if (!result.ok) {
      return attachEvents(session, {
        ok: false,
        reason: 'harness_unavailable',
        error: result.error || null
      });
    }

    const payload = result.value || {};
    if (!payload.ok) {
      return attachEvents(session, payload);
    }

    nudgeWatchPolling(session);

    const resources = [];
    if (Array.isArray(payload.resources)) {
      for (const resource of payload.resources) {
        if (!resource) continue;
        const encoding = resource.encoding || 'text';
        const data = resource.data || '';
        const bytes = encoding === 'base64'
          ? Buffer.from(data, 'base64')
          : Buffer.from(data, 'utf8');
        const mimeType = resource.mimeType || 'application/octet-stream';
        const stored = session.resources.put({
          sessionId: session.id,
          bytes,
          mimeType,
          meta: resource.meta || { kind: 'resource', name: resource.name || '' }
        });
        resources.push({
          uri: stored?.uri || null,
          mimeType,
          name: resource.name || null,
          sizeBytes: stored?.sizeBytes ?? null,
          meta: resource.meta || null
        });
      }
    }

    return attachEvents(session, {
      ok: true,
      results: Array.isArray(payload.results) ? payload.results : [],
      state: payload.state ?? null,
      resources
    });
  };

  const editorApplyTool = async (args) => {
    const parsed = EditorApplySchema.parse(args || {});
    const session = getSession(parsed.sessionId);
    return runEditorApply(session, parsed.ops || [], {
      atomic: parsed.atomic,
      dryRun: parsed.dryRun,
      history: parsed.history,
      preview: parsed.preview,
      validate: parsed.validate,
      returnState: parsed.returnState
    });
  };

  const listObjectsTool = async (args) => {
    const parsed = ObjectsListSchema.parse(args || {});
    const session = getSession(parsed.sessionId);
    const state = await getState(session);
    const level = getEditorLevelFromState(state);
    if (!level) {
      return attachEvents(session, {
        ok: false,
        reason: 'not_in_editor_mode'
      });
    }

    const kind = parsed.kind || 'all';
    const fields = parsed.fields || 'compact';
    const bbox = normalizeEditorBBox(parsed.bbox);
    let records = collectEditorObjectRecords(level, kind, fields);
    if (bbox) {
      records = records.filter((record) => editorBoundsIntersect(record, bbox));
    }
    const totalCount = records.length;
    const page = Number.isFinite(parsed.page) ? Math.max(0, parsed.page) : 0;
    const pageSize = Number.isFinite(parsed.pageSize) ? parsed.pageSize : 100;
    const start = page * pageSize;
    const pageRecords = records.slice(start, start + pageSize);
    const revision = getEditorRevisionFromState(state);
    const queryKey = JSON.stringify({ kind, fields, bbox: bbox || null });
    const currentSnapshot = new Map(records.map((record) => [record.id, record._hash]));
    let delta = null;
    if (Number.isFinite(parsed.sinceRevision)) {
      const previous = session.editorObjectListCache?.get(queryKey) || null;
      delta = buildEditorListDelta(
        previous,
        currentSnapshot,
        parsed.sinceRevision,
        revision
      );
    }
    cacheEditorListSnapshot(session, queryKey, revision, records);

    return attachEvents(session, {
      ok: true,
      revision,
      kind,
      page,
      pageSize,
      totalCount,
      entries: pageRecords.map((record) => {
        const { _hash, ...rest } = record;
        return rest;
      }),
      delta
    });
  };

  const placeObjectsTool = async (args) => {
    const parsed = ObjectsPlaceSchema.parse(args || {});
    const session = getSession(parsed.sessionId);
    const ops = parsed.objects.map((item, index) => ({
      opId: `objects.place.${index}`,
      type: 'entry.add',
      args: {
        kind: item.kind,
        props: item.props,
        piece: item.piece,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        insert: Number.isFinite(item.insertIndex) ? { index: item.insertIndex } : undefined
      }
    }));
    return runEditorApply(session, ops, parsed.options || {});
  };

  const updateObjectsTool = async (args) => {
    const parsed = ObjectsUpdateSchema.parse(args || {});
    const session = getSession(parsed.sessionId);
    const state = await getState(session);
    const level = getEditorLevelFromState(state);
    if (!level) {
      return attachEvents(session, {
        ok: false,
        reason: 'not_in_editor_mode'
      });
    }
    const ops = [];
    for (let index = 0; index < parsed.updates.length; index += 1) {
      const update = parsed.updates[index];
      const resolvedRef = resolveEditorObjectRef(level, update.ref);
      if (!resolvedRef) {
        return attachEvents(session, {
          ok: false,
          reason: 'invalid_ref',
          index
        });
      }
      ops.push({
        opId: `objects.update.${index}`,
        type: 'entry.update',
        args: {
          ref: resolvedRef,
          set: update.set || {},
          unset: update.unset || []
        }
      });
    }
    return runEditorApply(session, ops, parsed.options || {});
  };

  const deleteObjectsTool = async (args) => {
    const parsed = ObjectsDeleteSchema.parse(args || {});
    const session = getSession(parsed.sessionId);
    const state = await getState(session);
    const level = getEditorLevelFromState(state);
    if (!level) {
      return attachEvents(session, {
        ok: false,
        reason: 'not_in_editor_mode'
      });
    }
    const refs = [];
    for (let index = 0; index < parsed.refs.length; index += 1) {
      const resolvedRef = resolveEditorObjectRef(level, parsed.refs[index]);
      if (!resolvedRef) {
        return attachEvents(session, {
          ok: false,
          reason: 'invalid_ref',
          index
        });
      }
      refs.push(resolvedRef);
    }
    return runEditorApply(session, [{
      opId: 'objects.delete',
      type: 'entry.remove',
      args: { refs }
    }], parsed.options || {});
  };


  return {
    editorApplyTool,
    listObjectsTool,
    placeObjectsTool,
    updateObjectsTool,
    deleteObjectsTool
  };
};

export { createEditorObjectToolHandlers };
