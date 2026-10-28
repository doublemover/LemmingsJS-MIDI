export function createLaneDisplayView({ document, laneId }) {
  const element = document.createElement('output'); element.className = 'studio-lane-display'; element.dataset.laneDisplay = laneId;
  element.setAttribute('role', 'img');
  const lines = [document.createTextNode(''), document.createTextNode('')];
  for (const line of lines) { const row = document.createElement('span'); row.append(line); element.append(row); }
  const glyph = document.createElement('i'), glyphText = document.createTextNode('○'); glyph.setAttribute('aria-hidden', 'true'); glyph.append(glyphText); element.append(glyph);
  let current = null;
  return Object.freeze({ element,
    update(snapshot) {
      if (snapshot.laneId !== laneId) throw new Error('Lane display identity changed.'); current = snapshot;
      for (const [index, text] of [snapshot.top, snapshot.bottom].entries()) if (lines[index].data !== text) lines[index].data = text;
      if (glyphText.data !== (snapshot.glyph || '○')) glyphText.data = snapshot.glyph || '○';
      const accessible = `${snapshot.name}. ${snapshot.top}. ${snapshot.bottom}. ${snapshot.evidenceClass}. ${snapshot.completeness} coverage.`;
      if (element.getAttribute('aria-label') !== accessible) element.setAttribute('aria-label', accessible);
      for (const [key, value] of Object.entries({ page: snapshot.displayPage, priority: snapshot.priority, evidence: snapshot.evidenceClass, stale: String(snapshot.stale) })) if (element.dataset[key] !== value) element.dataset[key] = value;
    },
    snapshot: () => current,
    dispose() { current = null; element.remove(); }
  });
}
