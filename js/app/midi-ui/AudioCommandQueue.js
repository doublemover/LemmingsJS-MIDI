const terminal = command => command.opcode === 3 || command.opcode === 4 || command.opcode === 5;
const before = (left, right) => left.frame < right.frame || left.frame === right.frame && left.sequence < right.sequence;

export function createAudioCommandQueue({ capacity = 512, terminalReserve = 64, maxHorizonFrames = 480000 } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 4 || capacity > 65536 || !Number.isSafeInteger(terminalReserve) ||
      terminalReserve < 1 || terminalReserve >= capacity || !Number.isSafeInteger(maxHorizonFrames) || maxHorizonFrames < 1) throw new Error('Invalid audio queue limits.');
  const commands = [];
  const counters = { accepted: 0, rejected: 0, invalidated: 0, terminalPressure: 0 };
  const enqueue = (command, currentFrame) => {
    if (!command || !Number.isSafeInteger(command.frame) || command.frame < 0 || !Number.isSafeInteger(command.sequence) ||
        command.sequence < 0 || !Number.isSafeInteger(currentFrame) || currentFrame < 0 || command.frame - currentFrame > maxHorizonFrames) {
      counters.rejected++; return { status: 'rejected', reason: 'invalid-command-or-horizon' };
    }
    const isTerminal = terminal(command);
    if (commands.length >= (isTerminal ? capacity : capacity - terminalReserve)) {
      counters.rejected++; if (isTerminal) counters.terminalPressure++;
      return { status: 'rejected', reason: isTerminal ? 'terminal-queue-full' : 'audio-queue-full' };
    }
    const sealed = Object.freeze({ ...command });
    let index = commands.length;
    while (index > 0 && before(sealed, commands[index - 1])) index--;
    commands.splice(index, 0, sealed); counters.accepted++;
    return { status: 'accepted', stage: 'queued', frame: command.frame, sequence: command.sequence };
  };
  const drainThrough = (frame, maximum = capacity) => {
    let count = 0;
    while (count < commands.length && count < maximum && commands[count].frame <= frame) count++;
    return commands.splice(0, count);
  };
  const invalidate = predicate => {
    let removed = 0;
    for (let index = commands.length - 1; index >= 0; index--) if (predicate(commands[index])) { commands.splice(index, 1); removed++; }
    counters.invalidated += removed; return removed;
  };
  const clear = () => invalidate(() => true);
  return { enqueue, drainThrough, invalidate, clear,
    firstFrame: () => commands[0]?.frame ?? null,
    diagnostics: () => Object.freeze({ ...counters, queued: commands.length, capacity, terminalReserve, maxHorizonFrames }) };
}
