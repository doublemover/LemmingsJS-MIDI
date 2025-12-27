class EditorLevel {
  constructor() {
    this.header = {};
    this.headerOrder = [];
    this.skillset = new Map();
    this.terrains = [];
    this.gadgets = [];
    this.steel = [];
    this.terrainGroups = [];
    this.unknownSections = [];
    this.unknownLines = [];
  }

  static normalizeKey(key) {
    if (key == null) return '';
    return String(key).trim().toUpperCase();
  }

  setHeader(key, value) {
    const norm = EditorLevel.normalizeKey(key);
    if (!norm) return;
    if (!Object.prototype.hasOwnProperty.call(this.header, norm)) {
      this.headerOrder.push(norm);
    }
    this.header[norm] = value;
  }

  getHeader(key, fallback = undefined) {
    const norm = EditorLevel.normalizeKey(key);
    if (!norm) return fallback;
    return Object.prototype.hasOwnProperty.call(this.header, norm)
      ? this.header[norm]
      : fallback;
  }

  hasHeader(key) {
    const norm = EditorLevel.normalizeKey(key);
    if (!norm) return false;
    return Object.prototype.hasOwnProperty.call(this.header, norm);
  }

  removeHeader(key) {
    const norm = EditorLevel.normalizeKey(key);
    if (!norm) return;
    if (!Object.prototype.hasOwnProperty.call(this.header, norm)) return;
    delete this.header[norm];
    const idx = this.headerOrder.indexOf(norm);
    if (idx >= 0) this.headerOrder.splice(idx, 1);
  }

  setSkill(name, value) {
    const norm = EditorLevel.normalizeKey(name);
    if (!norm) return;
    this.skillset.set(norm, value);
  }

  getSkill(name, fallback = undefined) {
    const norm = EditorLevel.normalizeKey(name);
    if (!norm) return fallback;
    return this.skillset.has(norm) ? this.skillset.get(norm) : fallback;
  }
}

export { EditorLevel };
