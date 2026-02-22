const withinRect = (lem, rect) => {
  if (!rect) return true;
  const width = Number.isFinite(rect.w) ? rect.w : rect.width;
  const height = Number.isFinite(rect.h) ? rect.h : rect.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return (
    lem.x >= rect.x &&
    lem.x <= rect.x + width &&
    lem.y >= rect.y &&
    lem.y <= rect.y + height
  );
};

const compareTopCandidatePriority = (left, right) => {
  const leftCountdown = left?.countdownActive ? 1 : 0;
  const rightCountdown = right?.countdownActive ? 1 : 0;
  if (leftCountdown !== rightCountdown) return rightCountdown - leftCountdown;
  const leftX = Number.isFinite(left?.x) ? left.x : -Infinity;
  const rightX = Number.isFinite(right?.x) ? right.x : -Infinity;
  return rightX - leftX;
};

const insertBoundedTopCandidate = (top, candidate, topK) => {
  if (!candidate || topK <= 0) return;
  if (top.length >= topK && compareTopCandidatePriority(candidate, top[top.length - 1]) >= 0) {
    return;
  }

  let insertAt = top.length;
  while (insertAt > 0 && compareTopCandidatePriority(candidate, top[insertAt - 1]) < 0) {
    insertAt -= 1;
  }
  top.splice(insertAt, 0, candidate);
  if (top.length > topK) {
    top.pop();
  }
};

const buildLemmingSummary = (state, options = {}) => {
  const manager = state?.game?.lemmingManager || null;
  const tickIndex = state?.game?.timer?.tickIndex ?? null;
  const lemmings = Array.isArray(state?.game?.lemmings) ? state.game.lemmings : [];

  const includeSelected = options.includeSelected !== false;
  const activeOnly = options.activeOnly !== false;
  const viewRect = options.inViewOnly ? state?.stage?.viewRect : null;
  const rect = options.rectWorld || viewRect || null;
  const topK = Number.isFinite(options.topK) ? Math.max(0, Math.trunc(options.topK)) : 10;
  const sortAllCandidates = options.sortAllCandidates === true;

  const histAction = {};
  const histState = {};
  let climbers = 0;
  let floaters = 0;
  let countingDown = 0;
  let exploded = 0;

  let totalCount = 0;
  let activeCount = 0;
  let removedCount = 0;
  let disabledCount = 0;
  let candidates = sortAllCandidates ? [] : null;
  const top = sortAllCandidates ? null : [];

  for (const lem of lemmings) {
    if (!lem || !withinRect(lem, rect)) continue;
    totalCount += 1;

    const isRemoved = !!lem.removed;
    const isDisabled = !!lem.disabled;
    if (isRemoved) removedCount += 1;
    if (isDisabled) disabledCount += 1;

    const isActive = !(isRemoved || isDisabled);
    if (isActive) activeCount += 1;
    if (activeOnly && !isActive) continue;

    const action = lem.actionType ?? null;
    const stateCode = lem.state ?? null;
    if (action != null) {
      histAction[action] = (histAction[action] || 0) + 1;
    }
    if (stateCode != null) {
      histState[stateCode] = (histState[stateCode] || 0) + 1;
    }
    if (lem.canClimb) climbers += 1;
    if (lem.hasParachute) floaters += 1;
    if (lem.countdownActive) countingDown += 1;
    if (lem.hasExploded) exploded += 1;

    if (sortAllCandidates) {
      candidates.push(lem);
    } else {
      insertBoundedTopCandidate(top, lem, topK);
    }
  }

  if (sortAllCandidates) {
    if (candidates.length > 1) {
      candidates.sort(compareTopCandidatePriority);
    }
    candidates = candidates.slice(0, topK);
  }

  const selectedIndex = manager?.selectedIndex;
  const selected = includeSelected && Number.isFinite(selectedIndex) && selectedIndex >= 0
    ? (lemmings[selectedIndex] || null)
    : null;

  const resolvedTop = sortAllCandidates ? candidates : top;
  if (selected && !resolvedTop.some((lem) => lem?.id === selected.id)) {
    resolvedTop.unshift(selected);
    if (resolvedTop.length > topK) resolvedTop.pop();
  }

  return {
    tickIndex,
    selectedLemmingId: selected ? selected.id : null,
    totalCount,
    activeCount,
    removedCount,
    disabledCount,
    byActionType: histAction,
    byState: histState,
    climbers,
    floaters,
    countingDown,
    exploded,
    selected,
    top: resolvedTop
  };
};

export { buildLemmingSummary };
