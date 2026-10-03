export default class BattleStateMachine {
  constructor(hooks) {
    this.hooks = hooks;
  }

  // battles.json `initiative`: "enemy" = the enemies act before the heroes in every round
  // (the boss opens the round); anything else = heroes first.
  async run(heroes, enemies, { initiative = 'hero' } = {}) {
    await this.hooks.intro();
    if (this.hooks.isOver?.()) return 'INTERRUPTED';
    // hooks.resume (a rewind to the Recollection): that move first, then the rounds as usual.
    if (this.hooks.resume) {
      await this.hooks.resume();
      if (this.hooks.afterTurn) await this.hooks.afterTurn();
      if (this.hooks.isOver?.()) return 'INTERRUPTED';
      if (this.hooks.allEnemiesDown()) return this.finish('WIN');
      if (this.hooks.allHeroesDown()) return this.finish('LOSE');
    }

    const phases = initiative === 'enemy' ? [this.enemyPhase, this.heroPhase] : [this.heroPhase, this.enemyPhase];
    while (true) {
      if (this.hooks.roundStart) this.hooks.roundStart();
      for (const phase of phases) {
        const result = await phase.call(this, phase === this.heroPhase ? heroes : enemies);
        if (result) return result;
      }
    }
  }

  async heroPhase(heroes) {
    for (const hero of heroes) {
      if (!this.hooks.isAlive(hero)) continue;

      await this.hooks.playerTurn(hero);
      if (this.hooks.afterTurn) await this.hooks.afterTurn();

      // A battle event (endBattle) already ended the fight: no finish().
      if (this.hooks.isOver?.()) return 'INTERRUPTED';
      if (this.hooks.allEnemiesDown()) return this.finish('WIN');
    }
    return null;
  }

  async enemyPhase(enemies) {
    for (const enemy of enemies) {
      if (!this.hooks.isAlive(enemy)) continue;

      await this.hooks.enemyTurn(enemy);
      if (this.hooks.afterTurn) await this.hooks.afterTurn();

      if (this.hooks.isOver?.()) return 'INTERRUPTED';
      if (this.hooks.allHeroesDown()) return this.finish('LOSE');
      // A parry counter can finish the last enemy during its own turn.
      if (this.hooks.allEnemiesDown()) return this.finish('WIN');
    }
    return null;
  }

  finish(result) {
    this.hooks.onEnd(result);
    return result;
  }
}
