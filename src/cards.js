(function(global){
  function createCardSpecs(){
    const specs = [];

    for(let i=0;i<3;i++){
      specs.push({
        name:'Goblin',
        type:'monster',
        baseEnergy:1,
        stars:0,
        tributeCost:0,
        color:0x8bd14b,
        desc:'Passiva: ganha +1 para cada Goblin no campo (exceto si).\nAtivo (Fase de Efeitos): descarta 1 carta da mão para invocar um Goblin do baralho direto no campo (vai para a mão se não houver espaço). Uma vez por rodada.',
        passive:(owner, self)=>{
          let count = 0;
          for(const monster of owner.field){
            if(monster && monster.name === 'Goblin' && monster.id !== self.id){
              count++;
            }
          }
          return count;
        },
        requiresDiscard:true,
        active:(owner, self, scene)=>{
          let foundIndex = -1;
          for(let i=0;i<owner.deck.length;i++){
            if(owner.deck[i].name === 'Goblin'){ foundIndex = i; break; }
          }
          if(foundIndex < 0) return;
          const goblinCard = owner.deck.splice(foundIndex,1)[0];
          const emptySlot = owner.field.findIndex(slot=>slot===null);
          if(emptySlot >= 0){
            scene.placeCardInField(owner, goblinCard, emptySlot);
          } else {
            owner.hand.push(goblinCard);
          }
        }
      });
    }

    for(let i=0;i<2;i++){
      specs.push({
        name:'Ogre',
        type:'monster',
        baseEnergy:2,
        stars:0,
        tributeCost:0,
        color:0xd08b4b,
        desc:'Monstro simples 2 energia'
      });
    }

    for(let i=0;i<2;i++){
      specs.push({
        name:'Drake',
        type:'monster',
        baseEnergy:3,
        stars:0,
        tributeCost:0,
        color:0x4b8bd0,
        desc:'Monstro forte 3 energia'
      });
    }

    for(let i=0;i<2;i++){
      specs.push({
        name:'Wyvern',
        type:'monster',
        baseEnergy:4,
        stars:0,
        tributeCost:0,
        color:0x4bd0a0,
        desc:'Monstro aéreo 4 energia'
      });
    }

    specs.push({
      name:'Alquimista',
      type:'monster',
      baseEnergy:2,
      stars:0,
      tributeCost:0,
      color:0x9b59b6,
      desc:'Ativo (Fase de Efeitos): descarta 1 carta da mão para comprar 2 cartas. Uma vez por rodada.',
      requiresDiscard:true,
      active:(owner, self, scene)=>{
        scene.drawCard(owner);
        scene.drawCard(owner);
      }
    });

    for(let i=0;i<2;i++){
      specs.push({
        name:'Sábio Feiticeiro',
        type:'monster',
        baseEnergy:2,
        stars:0,
        tributeCost:0,
        color:0x5b8def,
        desc:'Ativo (Fase de Efeitos): descarta 1 carta da mão para ganhar +2 de energia (só nesta rodada). Uma vez por rodada.',
        requiresDiscard:true,
        active:(owner, self, scene)=>{
          self.tempBoost = (self.tempBoost||0) + 2;
        }
      });
    }

    for(let i=0;i<2;i++){
      specs.push({
        name:'Sword',
        type:'effect',
        baseEnergy:0,
        stars:0,
        tributeCost:0,
        color:0xd04b8b,
        effectKind:'buff',
        desc:'Efeito: descarta-se e aumenta +1 energia em um monstro.',
        applyEffect:(monster)=>{
          monster.tempBoost = (monster.tempBoost||0) + 1;
        }
      });
    }

    for(let i=0;i<2;i++){
      specs.push({
        name:'Adaga Amaldiçoada',
        type:'effect',
        baseEnergy:0,
        stars:0,
        tributeCost:0,
        color:0x6b1e3c,
        effectKind:'debuff',
        desc:'Efeito: descarta-se e retira 2 de energia de um monstro. Use no monstro inimigo.',
        applyEffect:(monster)=>{
          monster.tempBoost = (monster.tempBoost||0) - 2;
        }
      });
    }

    specs.push({
      name:'Elixir de Poder',
      type:'effect',
      baseEnergy:0,
      stars:0,
      tributeCost:0,
      color:0xd4af37,
      effectKind:'buff',
      desc:'Efeito: descarta-se e aumenta +3 energia em um monstro.',
      applyEffect:(monster)=>{
        monster.tempBoost = (monster.tempBoost||0) + 3;
      }
    });

    specs.push({
      name:'Golem',
      type:'monster',
      baseEnergy:5,
      stars:1,
      tributeCost:1,
      color:0x7a7a7a,
      desc:'Tributo 1: ao entrar, compra 1 carta.',
      onSummon:(owner, self, scene)=>{
        scene.drawCard(owner);
      }
    });

    specs.push({
      name:'Guardião de Pedra',
      type:'monster',
      baseEnergy:4,
      stars:1,
      tributeCost:1,
      color:0x8a8a5c,
      desc:'Tributo 1: ao entrar, todos os monstros inimigos perdem 1 de energia.',
      onSummon:(owner, self, scene)=>{
        const enemy = owner === scene.player ? scene.bot : scene.player;
        for(const monster of enemy.field){
          if(monster) monster.tempBoost = (monster.tempBoost||0) - 1;
        }
      }
    });

    specs.push({
      name:'Hydra',
      type:'monster',
      baseEnergy:7,
      stars:2,
      tributeCost:2,
      color:0x4db7a7,
      desc:'Tributo 2: ao entrar, dá +1 energia para todos os seus outros monstros.',
      onSummon:(owner, self)=>{
        for(const monster of owner.field){
          if(monster && monster.id !== self.id){
            monster.tempBoost += 1;
          }
        }
      }
    });

    specs.push({
      name:'Titan',
      type:'monster',
      baseEnergy:9,
      stars:3,
      tributeCost:3,
      color:0xd0c14b,
      desc:'Tributo 3: ao entrar, destrói o monstro inimigo com menor energia.',
      onSummon:(owner, self, scene)=>{
        const enemy = owner === scene.player ? scene.bot : scene.player;
        let weakestIndex = -1;
        let weakestValue = Infinity;
        for(let i=0;i<enemy.field.length;i++){
          const monster = enemy.field[i];
          if(!monster) continue;
          const value = scene.cardEffectiveEnergy(monster, enemy);
          if(value < weakestValue){
            weakestValue = value;
            weakestIndex = i;
          }
        }
        if(weakestIndex >= 0){
          enemy.field[weakestIndex] = null;
        }
      }
    });

    return specs;
  }

  function buildDecks(CardCtor){
    const specs = createCardSpecs();
    const playerDeck = Phaser.Utils.Array.Shuffle(specs.map(spec=>new CardCtor(Object.assign({}, spec))));
    const botDeck = Phaser.Utils.Array.Shuffle(specs.map(spec=>new CardCtor(Object.assign({}, spec))));
    return { playerDeck, botDeck };
  }

  global.CardLibrary = {
    createCardSpecs,
    buildDecks,
  };
})(globalThis);