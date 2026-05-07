const SOLVER_SURFACE = 'solver';
const SOLVER_NAMESPACES = Object.freeze(['solver']);

const SOLVER_HANDLER_MAP = Object.freeze([
  ['solver.snapshot', 'solverSnapshotTool'],
  ['solver.route', 'solverRouteTool'],
  ['solver.replay', 'solverReplayTool']
]);

const buildSolverToolSpecs = (schemas) => [
  {
    name: 'solver.snapshot',
    description: 'Extract compact deterministic solver snapshot hashes from a local source descriptor.',
    schema: schemas.SolverSnapshotSchema
  },
  {
    name: 'solver.route',
    description: 'Build a bounded reachability route skeleton without claiming runtime solvability.',
    schema: schemas.SolverRouteSchema
  },
  {
    name: 'solver.replay',
    description: 'Replay a candidate action script through the solver runtime adapter authority path.',
    schema: schemas.SolverReplaySchema
  }
];

const buildSolverToolHandlers = (handlers = {}) => {
  const routes = [];
  for (const [toolName, handlerKey] of SOLVER_HANDLER_MAP) {
    const handler = handlers[handlerKey];
    if (typeof handler !== 'function') {
      throw new Error(`Missing solver tool handler: ${handlerKey}`);
    }
    routes.push([toolName, handler]);
  }
  return new Map(routes);
};

export {
  SOLVER_NAMESPACES,
  SOLVER_SURFACE,
  buildSolverToolHandlers,
  buildSolverToolSpecs
};
