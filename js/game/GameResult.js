class GameResult {
  constructor(game) {
    this.state = game.getGameState();
    this.replay = game.getCommandManager().serialize();
    this.survivorPercentage = game.getVictoryCondition().getSurvivorPercentage();
    this.survivors = game.getVictoryCondition().getSurvivorsCount();
    this.duration = game.getGameTimer().getGameTicks();
  }
}
export { GameResult };
