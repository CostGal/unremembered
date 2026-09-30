export default class BattleStateMachine {
  constructor(hooks) {
    this.hooks = hooks;
  }

  async run(heroes, enemies) {
    await this.hooks.intro();

    while (true) {
      for (const hero of heroes) {
        if (!this.hooks.isAlive(hero)) continue;

        await this.hooks.playerTurn(hero);
        if (this.hooks.afterTurn) await this.hooks.afterTurn();

        if (this.hooks.allEnemiesDown()) return this.finish('WIN');
      }

      for (const enemy of enemies) {
        if (!this.hooks.isAlive(enemy)) continue;

        await this.hooks.enemyTurn(enemy);
        if (this.hooks.afterTurn) await this.hooks.afterTurn();

        if (this.hooks.allHeroesDown()) return this.finish('LOSE');
        // A parry counter can finish the last enemy during its own turn.
        if (this.hooks.allEnemiesDown()) return this.finish('WIN');
      }
    }
  }

  finish(result) {
    this.hooks.onEnd(result);
    return result;
  }
}
