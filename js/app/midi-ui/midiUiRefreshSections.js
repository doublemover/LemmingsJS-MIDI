import { isPlainObject } from '../../util/safeObject.js';

const deriveRefreshSectionsFromPatch = (patch) => {
  if (!isPlainObject(patch)) return null;
  const sections = new Set();
  if (Object.prototype.hasOwnProperty.call(patch, 'timing')) {
    sections.add('bpm');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scale')) {
    sections.add('scale');
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'velocityRange') ||
    Object.prototype.hasOwnProperty.call(patch, 'density')
  ) {
    sections.add('velocity');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'repeat')) {
    sections.add('repeat');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'input')) {
    sections.add('view');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'envelope')) {
    sections.add('envelope');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'position')) {
    sections.add('position');
    sections.add('view');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sfx')) {
    sections.add('events');
    sections.add('envTargets');
    sections.add('envelope');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'triggers')) {
    sections.add('triggers');
    sections.add('envTargets');
    sections.add('envelope');
  }
  return sections.size ? sections : null;
};

export { deriveRefreshSectionsFromPatch };
