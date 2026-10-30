import { getPointerGestureArbiter } from './PointerGestureArbiter.js';
import { DEFAULT_KEYBINDINGS, KeybindingRegistry } from '../../input/KeybindingRegistry.js';
import { formatBindingSpec } from '../../input/KeybindingFormatter.js';

const dispatchers = new WeakMap();
const navigation = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const controls = new Set(['BUTTON', 'SUMMARY', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
const roles = new Set(['separator', 'slider', 'spinbutton', 'tab', 'menuitem', 'radio', 'combobox', 'textbox', 'searchbox', 'menu', 'listbox', 'option', 'tree', 'treeitem']);
const textRoles = new Set(['textbox', 'searchbox', 'combobox', 'menu', 'menuitem', 'listbox', 'option', 'tree', 'treeitem']);
const eventPath = event => {
  const path = event.composedPath?.(); if (path?.length) return path;
  const result = []; for (let target = event.target; target; target = target.parentElement) result.push(target); return result;
};

export function procgenCommandInput(event, document) {
  const path = eventPath(event), key = event.key || event.code || '';
  const editing = path.some(node => node?.isContentEditable || textRoles.has(node?.getAttribute?.('role')) || ['TEXTAREA', 'SELECT'].includes(node?.tagName) ||
    node?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(node.type || 'text'));
  const interactive = path.some(node => controls.has(node?.tagName) || roles.has(node?.getAttribute?.('role')));
  const native = path.some(node => [' ', 'Enter', 'Space', 'NumpadEnter'].includes(key) &&
    (['BUTTON', 'SUMMARY', 'A'].includes(node?.tagName) || node?.tagName === 'INPUT' && ['checkbox', 'radio', 'button', 'submit'].includes(node.type)) ||
    navigation.has(key) && (node?.type === 'range' || node?.type === 'radio' || roles.has(node?.getAttribute?.('role'))));
  const hardBlocked = !!(event.defaultPrevented || event.isComposing || ['Dead', 'Process', 'Compose', 'Unidentified'].includes(key) || event.keyCode === 229 || native);
  return Object.freeze({ path, interactive, emergencyAllowed: !hardBlocked && key !== 'Escape',
    blocked: !!(hardBlocked || editing || document.querySelector?.('dialog[open]') || path.some(node => node?.tagName === 'DIALOG' && node.open)) });
}

export function getProcgenCommandDispatcher({ document, window }) {
  let dispatcher = dispatchers.get(window); if (dispatcher) return dispatcher;
  const groups = [], pressed = new Map(), consumed = new WeakSet(), events = new WeakMap(), bindingListeners = new Set(), arbiter = getPointerGestureArbiter(document);
  let installed = false, sequence = 0, bindingRevision = 0, bindingsReady = true, composing = false, overrides = Object.freeze(Object.create(null));
  let keybindings = new KeybindingRegistry({ bindings: Object.fromEntries(Object.keys(DEFAULT_KEYBINDINGS.bindings).map(key => [key, []])) });
  const compileBindings = (sources, config) => {
    const bindings = Object.fromEntries(Object.keys(DEFAULT_KEYBINDINGS.bindings).map(key => [key, []]));
    for (const group of sources) for (const command of group.commands) if (command.bindings) bindings[command.id] = Object.hasOwn(config, command.id) ? config[command.id] :
      command.bindingKey && Object.hasOwn(config, command.bindingKey) ? config[command.bindingKey] : command.bindings;
    return new KeybindingRegistry({ bindings });
  };
  const publishBindings = (prepared, config = overrides, ready = bindingsReady) => {
    if (!Number.isSafeInteger(bindingRevision + 1)) throw new Error('Command binding revision exhausted.');
    keybindings = prepared; overrides = config; bindingsReady = ready; bindingRevision++; pressed.clear();
    for (const listener of bindingListeners) try { listener(); } catch (error) { window.console?.error?.(error); }
  };
  const matches = (command, event, context) => {
    if (!command.bindings) return command.matches?.(event, context);
    if (!bindingsReady) return false;
    let entry = events.get(event);
    if (!entry || entry.revision !== bindingRevision) { entry = { revision: bindingRevision, actions: new Set(keybindings.getActionsForEvent(event.code ? event : { code: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey })) }; events.set(event, entry); }
    return entry.actions.has(command.id);
  };
  const shortcut = id => {
    if (!bindingsReady) return '';
    const bindings = keybindings.getBindingsForAction(id), mac = /Mac/.test(window.navigator?.platform || '');
    const selected = bindings.find(binding => mac ? binding.meta : !binding.meta) || bindings[0];
    const label = formatBindingSpec(selected); return mac ? label.replace(/\bMeta\b/g, 'Cmd').replace(/\bAlt\b/g, 'Option') : label.replace(/\bMeta\b/g, 'Win');
  };
  const consume = event => {
    if (!event || consumed.has(event)) return; consumed.add(event); event.preventDefault?.();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation(); else event.stopPropagation?.();
  };
  const invoke = (group, command, context, event, revision = bindingRevision) => {
    if (revision !== bindingRevision || !group.active || !group.isCurrent(context)) return Object.freeze({ status: 'stale' });
    if (arbiter.inspect() && !command.emergency) return Object.freeze({ status: 'captured-gesture' });
    if (command.enabled && !command.enabled(context, event)) return Object.freeze({ status: 'disabled' });
    consume(event);
    try {
      const value = command.execute(context, event);
      if (value?.then) value.catch(group.onError);
      return Object.freeze({ status: 'executed', id: command.id, value });
    } catch (error) { group.onError(error); return Object.freeze({ status: 'failed', id: command.id }); }
  };
  const continueKey = (held, event, key) => {
    const result = invoke(held.group, held.command, held.context, event, held.revision);
    if (result.status === 'executed' && held.group.active && held.revision === bindingRevision) { held.context = held.group.getContext(event); if (!pressed.has(key) && pressed.size === 16) pressed.delete(pressed.keys().next().value); pressed.set(key, held); }
    else pressed.delete(key);
    return result;
  };
  const find = (event, input, emergency = false) => {
    for (const group of groups) {
      if (!group.active || !group.accepts(event, input)) continue;
      const context = group.getContext(event), command = group.commands.find(command => (!emergency || command.emergency) && matches(command, event, context));
      if (command) return { group, command, context, revision: bindingRevision };
    }
    return null;
  };
  const dispatch = event => {
    const key = event.code || event.key, input = procgenCommandInput(event, document);
    if (composing || consumed.has(event)) { pressed.delete(key); return Object.freeze({ status: 'owned-input' }); }
    if (input.blocked) {
      pressed.delete(key);
      const emergency = input.emergencyAllowed && !event.repeat ? find(event, input, true) : null;
      return emergency ? continueKey(emergency, event, key) : Object.freeze({ status: 'owned-input' });
    }
    if (arbiter.inspect()) {
      pressed.clear();
      if (event.repeat) return Object.freeze({ status: 'repeat-ignored' });
      const target = find(event, input);
      if (target?.command.emergency) return continueKey(target, event, key);
      if (event.key === 'Escape' || target?.command.cancelGesture) {
        if (target?.command.cancelGesture && (!target.group.isCurrent(target.context) || target.command.enabled && !target.command.enabled(target.context, event))) return Object.freeze({ status: 'disabled' });
        consume(event);
        try { arbiter.cancel(event.key === 'Escape' ? 'escape' : 'command:' + target.command.id); }
        catch (error) { if (target) target.group.onError(error); else window.console?.error?.(error); return Object.freeze({ status: 'failed' }); }
        return target?.command.cancelGesture ? continueKey(target, event, key) : Object.freeze({ status: 'executed', id: 'gesture.cancel' });
      }
      return Object.freeze({ status: 'captured-gesture' });
    }
    if (event.repeat) {
      const held = pressed.get(key);
      if (!held || !held.command.repeat) return Object.freeze({ status: 'repeat-ignored' });
      if (!held.group.accepts(event, input) || !matches(held.command, event, held.group.getContext(event))) { pressed.delete(key); return Object.freeze({ status: 'stale' }); }
      return continueKey(held, event, key);
    }
    pressed.delete(key);
    const target = find(event, input);
    if (target) { if (pressed.size === 16) pressed.delete(pressed.keys().next().value); return continueKey(target, event, key); }
    return Object.freeze({ status: 'unmatched' });
  };
  const releaseKey = event => pressed.delete(event.code || event.key), clearKeys = () => pressed.clear();
  const beginComposition = () => { composing = true; clearKeys(); }, endComposition = () => { composing = false; clearKeys(); };
  const visibility = () => { if (document.hidden) endComposition(); };
  dispatcher = Object.freeze({ dispatch,
    setBindings(config = null) {
      const entries = Object.entries(config?.bindings && typeof config.bindings === 'object' && !Array.isArray(config.bindings) ? config.bindings : {});
      if (entries.length > 512) throw new TypeError('Shortcut configuration exceeds its action budget.');
      const next = Object.create(null);
      for (const [id, raw] of entries) {
        if (['__proto__', 'prototype', 'constructor'].includes(id) || id.length > 128) throw new TypeError('Unsupported shortcut action identity.');
        const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter(value => typeof value === 'string') : [];
        if (values.length > 16 || values.some(value => value.length > 128)) throw new TypeError('Shortcut configuration exceeds its binding budget.');
        next[id] = Object.freeze([...values]);
      }
      Object.freeze(next); publishBindings(compileBindings(groups, next), next, true);
    },
    setBindingsPending() { publishBindings(keybindings, overrides, false); },
    getShortcut: shortcut,
    bindingState: () => Object.freeze({ ready: bindingsReady, revision: bindingRevision }),
    watchBindings(listener) {
      if (typeof listener !== 'function' || bindingListeners.size >= 8) throw new TypeError('Invalid shortcut observer.');
      bindingListeners.add(listener); return () => bindingListeners.delete(listener);
    },
    register({ commands, getContext = () => null, isCurrent = () => true, accepts = () => true, priority = 0, onError = error => window.console?.error?.(error) }) {
      if (!Array.isArray(commands) || !commands.length || commands.length > 64 || groups.reduce((sum, group) => sum + group.commands.length, 0) + commands.length > 96 ||
          new Set(commands.map(command => command.id)).size !== commands.length || commands.some(command => typeof command.id !== 'string' || !command.id || ['__proto__', 'prototype', 'constructor'].includes(command.id) ||
            groups.some(group => group.commands.some(existing => existing.id === command.id)) || typeof command.label !== 'string' || typeof command.execute !== 'function' ||
            command.bindings && (!Array.isArray(command.bindings) || command.bindings.length > 16 || command.bindings.some(value => typeof value !== 'string' || value.length > 128))) ||
          !Number.isFinite(priority) || ![getContext, isCurrent, accepts, onError].every(value => typeof value === 'function')) throw new TypeError('Invalid desktop command registration.');
      if (!Number.isSafeInteger(sequence + 1)) throw new Error('Command registration identity exhausted.');
      const group = { commands: commands.map(command => Object.freeze({ ...command, ...(command.bindings ? { bindings: Object.freeze([...command.bindings]) } : {}) })), getContext, isCurrent, accepts, priority, onError, active: true, sequence: ++sequence };
      const prepared = compileBindings([...groups, group], overrides);
      groups.push(group); groups.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      publishBindings(prepared);
      if (!installed) {
        window.addEventListener('keydown', dispatch); window.addEventListener('keyup', releaseKey); window.addEventListener('blur', endComposition);
        window.addEventListener('compositionstart', beginComposition, true); window.addEventListener('compositionend', endComposition, true); document.addEventListener('visibilitychange', visibility); installed = true;
      }
      return Object.freeze({ dispose() {
        if (!group.active) return false; group.active = false; groups.splice(groups.indexOf(group), 1);
        publishBindings(compileBindings(groups, overrides));
        if (!groups.length && installed) {
          window.removeEventListener('keydown', dispatch); window.removeEventListener('keyup', releaseKey); window.removeEventListener('blur', endComposition);
          window.removeEventListener('compositionstart', beginComposition, true); window.removeEventListener('compositionend', endComposition, true); document.removeEventListener('visibilitychange', visibility); composing = false; installed = false;
        }
        return true;
      } });
    },
    list() {
      return Object.freeze(groups.flatMap(group => {
        const context = group.getContext(), revision = bindingRevision;
        return group.commands.map(command => Object.freeze({ id: command.id, label: command.label, contexts: Object.freeze([...(command.contexts || [])]),
          shortcut: typeof command.shortcut === 'function' ? command.shortcut() : command.shortcut || shortcut(command.id), repeat: !!command.repeat,
          enabled: (!arbiter.inspect() || !!command.emergency) && group.isCurrent(context) && (!command.enabled || command.enabled(context)),
          canRun: () => revision === bindingRevision && group.active && (!arbiter.inspect() || !!command.emergency) && group.isCurrent(context) && (!command.enabled || command.enabled(context)), run: () => invoke(group, command, context, undefined, revision) }));
      }));
    },
    inspect: () => Object.freeze({ groups: groups.length, commands: groups.reduce((sum, group) => sum + group.commands.length, 0), installed, heldKeys: pressed.size, bindingsReady, bindingRevision, composing })
  });
  dispatchers.set(window, dispatcher); return dispatcher;
}
