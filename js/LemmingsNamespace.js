// LemmingsNamespace.js
export const Lemmings = {};

/* NEW — make it visible to non-module scripts */
if (typeof window !== 'undefined') {
  window.Lemmings = Lemmings;
}
