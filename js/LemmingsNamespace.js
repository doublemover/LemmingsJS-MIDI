// LemmingsNamespace.js
export const Lemmings = {};

// single place for global counters to wrap
Lemmings.COUNTER_LIMIT = 0x7fffffff;

/* NEW — make it visible to non-module scripts */
if (typeof window !== 'undefined') {
  window.Lemmings = Lemmings;
}
