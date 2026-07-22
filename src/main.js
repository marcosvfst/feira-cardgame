/* Feira Cardgame - minimal Phaser demo
   Implements a simple 3-phase card game with placeholder cards and a bot opponent.
*/

const WIDTH = 1920;
const HEIGHT = 1080;

function makeId(){
  if(globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'){
    return globalThis.crypto.randomUUID();
  }
  return `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

class Card {
  constructor(spec){
    this.id = spec.id || makeId();
    this.name = spec.name;
    this.type = spec.type; // 'monster' | 'effect'
    this.baseEnergy = spec.baseEnergy || 0;
    this.stars = spec.stars || 0;
    this.tributeCost = spec.tributeCost != null ? spec.tributeCost : this.stars;
    this.passive = spec.passive || null; // function(owner, self, scene) -> number
    this.active = spec.active || null; // function(owner, self, scene) -> void (effects phase, once per round)
    this.requiresDiscard = spec.requiresDiscard || false; // if true, player picks a card to discard before active() runs
    this.activeUsed = false; // reset every round
    this.onSummon = spec.onSummon || null; // function(owner, self, scene) -> void
    this.applyEffect = spec.applyEffect || null; // function(targetMonster, scene) -> void (for type 'effect')
    this.effectKind = spec.effectKind || 'buff'; // 'buff' | 'debuff' - used by bot to pick a target
    this.desc = spec.desc || '';
    this.color = spec.color || 0x888888;
    this.tempBoost = 0; // applied by effects
  }
}

class PlayerState {
  constructor(name){
    this.name = name;
    this.deck = [];
    this.hand = [];
    this.field = [null,null,null];
    this.wins = 0;
  }
}

class MainScene extends Phaser.Scene{
  constructor(){
    super({key:'MainScene'});
  }
  preload(){ }
  create(){
    this.cameras.main.setBackgroundColor('#0b2b3a');
    // UI containers
    const uiLayer = document.getElementById('ui-layer') || document.body;
    this.uiLayer = uiLayer;
    this.zoomHost = document.createElement('div');
    this.zoomHost.className = 'zoom-panel';
    this.zoomHost.id = 'zoom';
    uiLayer.appendChild(this.zoomHost);
    // Phase label and victory circles (DOM overlays)
    const phaseLabel = document.createElement('div');
    phaseLabel.className = 'phase-label';
    phaseLabel.id = 'phaseLabel';
    phaseLabel.innerText = 'Preparando...';
    uiLayer.appendChild(phaseLabel);

    const vL = document.createElement('div'); vL.className='victory-circle victory-left'; vL.id='victLeft'; uiLayer.appendChild(vL);
    const vR = document.createElement('div'); vR.className='victory-circle victory-right'; vR.id='victRight'; uiLayer.appendChild(vR);

    this.phaseLabel = phaseLabel;
    this.zoomDom = document.getElementById('zoom');
    this.vLeft = document.getElementById('victLeft');
    this.vRight = document.getElementById('victRight');

    this.passButton = document.createElement('button');
    this.passButton.id = 'passButton';
    this.passButton.className = 'pass-button';
    this.passButton.innerText = 'Passar vez';
    this.passButton.addEventListener('click', ()=>this.passTurn());
    uiLayer.appendChild(this.passButton);

    // rendering control while dragging
    this.suspendRender = false;

    // Drag handlers with visual feedback and snap/return animations
    this.input.on('dragstart', (pointer, gameObject)=>{
      if(gameObject.getData && gameObject.getData('card')){
        const container = gameObject.parentContainer || gameObject;
        container.setDepth(1000);
        container.alpha = 0.9;
        container.setData('origX', container.x);
        container.setData('origY', container.y);
        // store pointer offset relative to container center
        container.setData('dragOffsetX', pointer.x - container.x);
        container.setData('dragOffsetY', pointer.y - container.y);
        this.suspendRender = true;
      }
    });
    this.input.on('drag', (pointer, gameObject, dragX, dragY)=>{
      if(gameObject.getData && gameObject.getData('card')){
        const container = gameObject.parentContainer || gameObject;
        const offX = container.getData('dragOffsetX') || 0;
        const offY = container.getData('dragOffsetY') || 0;
        container.x = pointer.x - offX;
        container.y = pointer.y - offY;
        // show highlight if over a valid drop
        const card = gameObject.getData('card') || container.getData && container.getData('card');
        const px = pointer.x, py = pointer.y;
        let found = false;
        if(this.phase==='place' && card.type==='monster'){
          for(let i=0;i<this.fieldSlots.length;i++){
            const slot = this.fieldSlots[i];
            const dx = Math.abs(px - slot.x);
            const dy = Math.abs(py - (this.playerFieldY));
            if(dx < this.cardW/1.5 && dy < this.cardH/1.5 && !this.player.field[i]){
              if(this.dropHighlight){ this.dropHighlight.x = slot.x; this.dropHighlight.y = this.playerFieldY; this.dropHighlight.setVisible(true); }
              found = true; break;
            }
          }
        }
        if(!found && this.phase==='effects' && card.type==='effect'){
          for(let i=0;i<3;i++){
            const mx = this.fieldSlots[i].x;
            const myP = this.playerFieldY;
            const myO = this.opponentY;
            if(this.player.field[i] && Math.abs(px-mx) < this.cardW/1.5 && Math.abs(py-myP) < this.cardH/1.5){ if(this.dropHighlight){ this.dropHighlight.x=mx; this.dropHighlight.y=myP; this.dropHighlight.setVisible(true);} found=true; break; }
            if(this.bot.field[i] && Math.abs(px-mx) < this.cardW/1.5 && Math.abs(py-myO) < this.cardH/1.5){ if(this.dropHighlight){ this.dropHighlight.x=mx; this.dropHighlight.y=myO; this.dropHighlight.setVisible(true);} found=true; break; }
          }
        }
        if(!found && this.dropHighlight) this.dropHighlight.setVisible(false);
      }
    });
    this.input.on('dragend', (pointer, gameObject)=>{
      if(!gameObject.getData) return;
      const container = gameObject.parentContainer || gameObject;
      const card = gameObject.getData('card') || (container.getData && container.getData('card'));
      if(!card) return;
      if(this.pendingTribute || this.pendingPlacement || this.pendingDiscard){
        const ox = container.getData('origX') || container.x;
        const oy = container.getData('origY') || container.y;
        this.tweens.add({targets: container, x: ox, y: oy, duration:220, ease:'Cubic'});
        container.alpha = 1;
        this.suspendRender = false;
        this.renderAll();
        return;
      }
      // determine drop target by pointer location
      const px = pointer.x; const py = pointer.y;
      // If placing monster during place phase
      if(this.phase==='place' && card.type==='monster'){
        for(let i=0;i<this.fieldSlots.length;i++){
          const slot = this.fieldSlots[i];
          const dx = Math.abs(px - slot.x);
          const dy = Math.abs(py - (this.playerFieldY));
          if(dx < this.cardW/1.5 && dy < this.cardH/1.5){
            if(this.placeMonsterForOwner(this.player, card, i, container)){
              break;
            }
          }
        }
      }
      // If applying effect during effects phase, check monsters (both sides)
      if(this.phase==='effects' && card.type==='effect'){
        // check each monster rect position
        for(let i=0;i<3;i++){
          const mx = this.fieldSlots[i].x;
          const myP = this.playerFieldY; // player monster y
          const myO = this.opponentY; // opponent monster y
          if(this.player.field[i]){
            if(Math.abs(px-mx) < this.cardW/1.5 && Math.abs(py-myP) < this.cardH/1.5){
              // apply to player monster
              const idx = this.player.hand.findIndex(c=>c.id===card.id);
              if(idx>=0){ this.player.hand.splice(idx,1); this.applyEffectCard(card, this.player.field[i]); }
              // fade out effect card container
              this.tweens.add({targets: container, alpha:0, scaleX:0.5, scaleY:0.5, duration:180, onComplete: ()=>{ try{ container.destroy(); }catch(e){} }});
              break;
            }
          }
          if(this.bot.field[i]){
            if(Math.abs(px-mx) < this.cardW/1.5 && Math.abs(py-myO) < this.cardH/1.5){
              const idx = this.player.hand.findIndex(c=>c.id===card.id);
              if(idx>=0){ this.player.hand.splice(idx,1); this.applyEffectCard(card, this.bot.field[i]); }
              this.tweens.add({targets: container, alpha:0, scaleX:0.5, scaleY:0.5, duration:180, onComplete: ()=>{ try{ container.destroy(); }catch(e){} }});
              break;
            }
          }
        }
      }

      // hide highlight
      if(this.dropHighlight) this.dropHighlight.setVisible(false);

      // if not placed/applied, return to origin
      const stillInHand = this.player.hand.findIndex(c=>c.id===card.id) >= 0;
      if(stillInHand){
        const ox = container.getData('origX') || container.x;
        const oy = container.getData('origY') || container.y;
        this.tweens.add({targets: container, x: ox, y: oy, duration:220, ease:'Cubic'});
      }

      container.alpha = 1;
      // resume rendering after drag completes
      this.suspendRender = false;
      this.renderAll();
    });

    // Game state
    this.player = new PlayerState('You');
    this.bot = new PlayerState('Bot');
    this.activePlayer = this.player; // whose turn to place / effect, but both act in phases
    this.selectedCard = null;
    this.selectedCardSprite = null;

    this.round = 1; // 1..3
    this.phase = 'draw'; // draw, place, effects
    this.playerPassed = false;
    this.botPassed = false;
    this.pendingTribute = null;
    this.pendingPlacement = null;
    this.pendingDiscard = null;

    this.createCards();
    this.setupGraphics();
    this.startMatch();
    this.renderAll();
  }

  createCards(){
    if(!globalThis.CardLibrary){
      throw new Error('CardLibrary nao carregada. Verifique se src/cards.js vem antes de src/main.js.');
    }
    const decks = globalThis.CardLibrary.buildDecks(Card);
    this.player.deck = decks.playerDeck;
    this.bot.deck = decks.botDeck;
  }

  setupGraphics(){
    // Hand area for player
    this.handGroup = this.add.group();
    this.botHandGroup = this.add.group();
    this.fieldGroup = this.add.group();

    // Player hand positions
    this.handY = HEIGHT - 150;
    // place field rows closer to center
    this.fieldCenterY = Math.round(HEIGHT/2);
    this.opponentY = this.fieldCenterY - 140;
    this.playerFieldY = this.fieldCenterY + 140;
    // opponent's hand is shown in its own row, clear of the field slots
    this.botHandY = 130;
    this.cardW = 150;
    this.cardH = 210;

    // Field slots (3 for each)
    this.fieldSlots = [];
    const startX = WIDTH/2 - 170;
    for(let i=0;i<3;i++){
      const x = startX + i*170;
      // opponent slot
      const oppRect = this.add.rectangle(x, this.opponentY, this.cardW, this.cardH, 0x18313f).setStrokeStyle(2,0x4b7084);
      oppRect.setAlpha(0.9);
      // player slot
      const plRect = this.add.rectangle(x, this.playerFieldY, this.cardW, this.cardH, 0x18313f).setStrokeStyle(2,0x4b7084);
      plRect.setAlpha(0.9);
      this.fieldSlots.push({x,oppRect,plRect});
    }

    // highlight used during drag-over (hidden by default)
    this.dropHighlight = this.add.rectangle(0,0,this.cardW,this.cardH).setStrokeStyle(4,0xffea00).setVisible(false).setDepth(900);

    // Input zone for clicks on field
    this.input.on('gameobjectdown', (pointer, gameObject)=>{
      if(gameObject.cardRef){
        this.onCardClicked(gameObject.cardRef, gameObject);
      } else if(gameObject.slotIndex!==undefined){
        this.onFieldSlotClicked(gameObject.slotIndex);
      }
    });

    // Create interactive slot sprites
    for(let i=0;i<3;i++){
      const s = this.add.zone(this.fieldSlots[i].x, this.handY-180, this.cardW, this.cardH).setRectangleDropZone(this.cardW,this.cardH).setInteractive();
      s.slotIndex = i;
      s.input.cursor = 'pointer';
      s.on('pointerdown', ()=>this.onFieldSlotClicked(i));
    }

    // text info
    this.infoText = this.add.text(12, HEIGHT-28, '', {font:'16px Arial', fill:'#fff'}).setDepth(5);

    // selected card zoom will be rendered into DOM
    this.renderAll();
  }

  startMatch(){
    // Each player draws 5 then rounds of draw 1
    for(let i=0;i<5;i++){ this.drawCard(this.player); this.drawCard(this.bot); }
    this.round = 1; this.player.wins=0; this.bot.wins=0;
    this.startRound();
  }

  startRound(){
    this.beginPhase('draw', `Fase de Compra - Round ${this.round}`);
    if(this.round>1){ this.drawCard(this.player); this.drawCard(this.bot); }
    this.beginPlacePhase();
  }

  beginPhase(phaseName, labelText){
    this.phase = phaseName;
    this.phaseLabel.innerText = labelText;
    this.playerPassed = false;
    this.botPassed = false;
    this.updateControls();
  }

  passTurn(){
    if(this.phase === 'match-over') return;
    if(this.playerPassed) return;
    this.playerPassed = true;
    this.updateControls();
    this.checkPhaseComplete();
  }

  botPassTurn(){
    this.botPassed = true;
    this.updateControls();
    this.checkPhaseComplete();
  }

  checkPhaseComplete(){
    if(!this.playerPassed || !this.botPassed) return;

    if(this.phase === 'draw'){
      this.beginPlacePhase();
    } else if(this.phase === 'place'){
      this.beginEffectsPhase();
    } else if(this.phase === 'effects'){
      this.evaluateRound();
    }
  }

  beginPlacePhase(){
    this.beginPhase('place', 'Fase de Colocar Monstros');
    this.botPlayPlace();
    this.botPassTurn();
  }

  botPlayPlace(){
    // simple: try to place monster cards into each slot, tributing if needed
    for(let i=0;i<3;i++){
      for(let j=0;j<this.bot.hand.length;j++){
        const c=this.bot.hand[j];
        if(c.type==='monster' && this.placeMonsterForOwner(this.bot, c, i, null)){
          break;
        }
      }
    }
    this.renderAll();
  }

  beginEffectsPhase(){
    this.beginPhase('effects', 'Fase de Efeitos');
    this.botPlayEffects();
    this.botPassTurn();
  }

  botPlayEffects(){
    // Play each effect card intelligently: buffs go on the bot's strongest monster,
    // debuffs go on the player's strongest (most threatening) monster.
    const effects = [...this.bot.hand.filter(c=>c.type==='effect')];
    for(const eff of effects){
      const isDebuff = eff.effectKind === 'debuff';
      const targetOwner = isDebuff ? this.player : this.bot;
      let bestIdx=-1; let best=-Infinity;
      for(let i=0;i<3;i++){
        const m = targetOwner.field[i];
        if(!m) continue;
        const val = this.cardEffectiveEnergy(m, targetOwner);
        if(val>best){ best=val; bestIdx=i; }
      }
      if(bestIdx>=0){
        const idx = this.bot.hand.indexOf(eff);
        if(idx>=0){
          this.bot.hand.splice(idx,1);
          this.applyEffectCard(eff, targetOwner.field[bestIdx]);
        }
      }
    }
    // Activate every available active ability on the bot's field
    for(let i=0;i<3;i++){
      const m = this.bot.field[i];
      if(m && m.active && !m.activeUsed){
        this.activateCard(this.bot, m);
      }
    }
    this.renderAll();
  }

  evaluateRound(){
    // compute total energy on field for each player
    const pVal = this.totalFieldEnergy(this.player);
    const bVal = this.totalFieldEnergy(this.bot);
    if(pVal>bVal) this.player.wins++; else if(bVal>pVal) this.bot.wins++;
    // update victory circles UI
    this.vLeft.className = 'victory-circle victory-left' + (this.player.wins>0? ' filled':'');
    this.vRight.className = 'victory-circle victory-right' + (this.bot.wins>0? ' filled':'');
    // prepare next round or end match
    if(this.round>=3){
      this.phase = 'match-over';
      this.phaseLabel.innerText = `Match Over - You ${this.player.wins} x ${this.bot.wins} Bot`;
      this.playerPassed = true;
      this.botPassed = true;
    } else {
      this.round++;
      // clear field temps
      for(let c of [...this.player.field,...this.bot.field]) if(c){ c.tempBoost=0; c.activeUsed=false; }
      this.time.delayedCall(600, ()=>this.startRound());
    }
    this.updateControls();
    this.renderAll();
  }

  totalFieldEnergy(owner){
    let sum=0;
    for(let m of owner.field) if(m) sum += this.cardEffectiveEnergy(m, owner);
    return sum;
  }

  cardEffectiveEnergy(card, owner){
    let val = card.baseEnergy + (card.tempBoost||0);
    if(card.passive) val += card.passive(owner, card, this);
    return val;
  }

  getOwner(card){
    if(this.player.field.some(c=>c && c.id===card.id) || this.player.hand.some(c=>c && c.id===card.id) || this.player.deck.some(c=>c && c.id===card.id)) return this.player;
    return this.bot;
  }

  drawCard(owner){
    if(owner.deck.length===0) return;
    owner.hand.push(owner.deck.pop());
    this.renderAll();
  }

  getTributeCost(card){
    if(!card || card.type !== 'monster') return 0;
    return Math.max(0, card.tributeCost || 0);
  }

  getTributeSacrifices(owner, slotIndex, tributeCost){
    const sacrifices = [];

    const occupied = owner.field[slotIndex];
    if(occupied){
      sacrifices.push({ index: slotIndex, card: occupied });
    }

    const pool = [];
    for(let i=0;i<owner.field.length;i++){
      if(i === slotIndex) continue;
      const monster = owner.field[i];
      if(monster) pool.push({ index: i, card: monster });
    }

    pool.sort((a, b)=>this.cardEffectiveEnergy(a.card, owner) - this.cardEffectiveEnergy(b.card, owner));

    for(const entry of pool){
      if(sacrifices.length >= tributeCost) break;
      sacrifices.push(entry);
    }

    if(sacrifices.length < tributeCost) return null;
    return sacrifices;
  }

  placeCardInField(owner, card, index){
    owner.field[index] = card;
    if(card.onSummon){
      card.onSummon(owner, card, this);
    }
  }

  applyEffectCard(effectCard, targetMonster){
    if(!effectCard || !targetMonster) return;
    if(effectCard.applyEffect){
      effectCard.applyEffect(targetMonster, this);
    } else {
      targetMonster.tempBoost = (targetMonster.tempBoost||0) + 1;
    }
  }

  activateCard(owner, card){
    if(!card || !card.active || card.activeUsed) return false;

    if(card.requiresDiscard){
      if(owner.hand.length === 0) return false; // nothing to discard, can't activate

      if(owner === this.player){
        // let the player pick which card to discard
        this.pendingDiscard = { owner, card };
        this.selectedCard = null;
        this.selectedCardLocation = null;
        this.renderZoom();
        this.updateControls();
        return true;
      }

      // bot: auto-pick a card to discard (last card in hand)
      owner.hand.splice(owner.hand.length - 1, 1);
      card.active(owner, card, this);
      card.activeUsed = true;
      this.renderZoom();
      this.renderAll();
      return true;
    }

    card.active(owner, card, this);
    card.activeUsed = true;
    this.renderZoom();
    this.renderAll();
    return true;
  }

  confirmDiscardSelection(handIndex){
    if(!this.pendingDiscard || this.pendingDiscard.owner !== this.player) return false;
    const pending = this.pendingDiscard;
    if(handIndex < 0 || handIndex >= pending.owner.hand.length) return false;

    pending.owner.hand.splice(handIndex, 1);
    this.pendingDiscard = null;
    pending.card.active(pending.owner, pending.card, this);
    pending.card.activeUsed = true;
    this.selectedCard = null;
    this.selectedCardLocation = null;
    this.renderZoom();
    this.renderAll();
    this.updateControls();
    return true;
  }

  cancelDiscardSelection(){
    if(!this.pendingDiscard) return;
    this.pendingDiscard = null;
    this.selectedCard = null;
    this.selectedCardLocation = null;
    this.renderZoom();
    this.renderAll();
    this.updateControls();
  }

  placeMonsterForOwner(owner, card, slotIndex, container){
    if(this.phase !== 'place' || !card || card.type !== 'monster') return false;
    const handIndex = owner.hand.findIndex(c=>c.id === card.id);
    if(handIndex < 0) return false;

    const tributeCost = this.getTributeCost(card);
    if(tributeCost === 0){
      if(owner.field[slotIndex]) return false;
      const summonedCard = owner.hand.splice(handIndex, 1)[0];
      this.placeCardInField(owner, summonedCard, slotIndex);
      if(container){
        this.tweens.add({targets: container, x: this.fieldSlots[slotIndex].x, y: owner === this.player ? this.playerFieldY : this.opponentY, duration: 180, ease: 'Power2'});
      }
      return true;
    } else {
      if(owner !== this.player){
        const sacrifices = this.getTributeSacrifices(owner, slotIndex, tributeCost);
        if(!sacrifices) return false;

        owner.hand.splice(handIndex, 1);
        for(const sacrifice of sacrifices){
          owner.field[sacrifice.index] = null;
        }
        this.placeCardInField(owner, card, slotIndex);

        if(container){
          this.tweens.add({targets: container, x: this.fieldSlots[slotIndex].x, y: owner === this.player ? this.playerFieldY : this.opponentY, duration: 180, ease: 'Power2'});
        }
        return true;
      }

      const available = owner.field
        .map((monster, index)=>monster ? {index, card: monster} : null)
        .filter(Boolean);
      if(available.length < tributeCost) return false;

      this.pendingTribute = {
        owner,
        card,
        slotIndex,
        tributeCost,
        selectedIndices: []
      };
      this.selectedCard = card;
      this.selectedCardLocation = 'hand';
      this.renderZoom();
      this.updateControls();
      return true;
    }
    return true;
  }

  toggleTributeSelection(fieldIndex){
    if(!this.pendingTribute || this.pendingTribute.owner !== this.player) return;
    const monster = this.player.field[fieldIndex];
    if(!monster) return;

    const selected = this.pendingTribute.selectedIndices;
    const existing = selected.indexOf(fieldIndex);
    if(existing >= 0){
      selected.splice(existing, 1);
    } else {
      if(selected.length >= this.pendingTribute.tributeCost) return;
      selected.push(fieldIndex);
    }

    this.renderZoom();
    this.renderAll();
    this.updateControls();
  }

  cancelTributeSelection(){
    if(!this.pendingTribute) return;
    this.pendingTribute = null;
    this.renderZoom();
    this.renderAll();
    this.updateControls();
  }

  confirmTributeSelection(){
    if(!this.pendingTribute || this.pendingTribute.owner !== this.player) return false;
    const pending = this.pendingTribute;
    if(pending.selectedIndices.length !== pending.tributeCost) return false;

    const handIndex = pending.owner.hand.findIndex(c=>c.id === pending.card.id);
    if(handIndex < 0) return false;

    pending.owner.hand.splice(handIndex, 1);
    for(const index of pending.selectedIndices){
      pending.owner.field[index] = null;
    }
    this.pendingTribute = null;

    const emptySlots = pending.owner.field
      .map((monster, index)=>monster === null ? index : null)
      .filter(index => index !== null);

    if(emptySlots.length <= 1){
      // Only one possible spot (or the sacrifices freed exactly the drop slot) - place directly.
      const targetIndex = emptySlots.length === 1 ? emptySlots[0] : pending.slotIndex;
      this.placeCardInField(pending.owner, pending.card, targetIndex);
      this.selectedCard = null;
      this.selectedCardLocation = null;
    } else {
      // Let the player choose which empty slot the new monster spawns in.
      this.pendingPlacement = { owner: pending.owner, card: pending.card };
      this.selectedCard = pending.card;
      this.selectedCardLocation = 'hand';
    }

    this.renderZoom();
    this.renderAll();
    this.updateControls();
    return true;
  }

  confirmPlacement(slotIndex){
    if(!this.pendingPlacement || this.pendingPlacement.owner !== this.player) return false;
    const pending = this.pendingPlacement;
    if(pending.owner.field[slotIndex] !== null) return false;

    this.placeCardInField(pending.owner, pending.card, slotIndex);
    this.pendingPlacement = null;
    this.selectedCard = null;
    this.selectedCardLocation = null;
    this.renderZoom();
    this.renderAll();
    this.updateControls();
    return true;
  }

  updateControls(){
    if(!this.passButton) return;
    if(this.pendingDiscard){
      this.passButton.disabled = true;
      this.passButton.innerText = 'Escolha uma carta para descartar';
      return;
    }
    if(this.pendingPlacement){
      this.passButton.disabled = true;
      this.passButton.innerText = 'Escolha onde posicionar o monstro';
      return;
    }
    if(this.pendingTribute){
      this.passButton.disabled = true;
      this.passButton.innerText = `Selecionando tributo (${this.pendingTribute.selectedIndices.length}/${this.pendingTribute.tributeCost})`;
      return;
    }
    if(this.phase === 'match-over'){
      this.passButton.disabled = true;
      this.passButton.innerText = 'Jogo encerrado';
      return;
    }
    this.passButton.disabled = this.playerPassed;
    this.passButton.innerText = this.playerPassed ? 'Aguardando bot...' : `Passar vez (${this.phase})`;
  }

  onCardClicked(card, sprite){
    if(this.pendingDiscard) return; // must resolve the discard prompt first
    if(this.pendingTribute && this.pendingTribute.owner === this.player && sprite && sprite.cardLocation === 'field'){
      const fieldIndex = this.player.field.findIndex(c=>c && c.id === card.id);
      if(fieldIndex >= 0){
        this.toggleTributeSelection(fieldIndex);
        return;
      }
    }

    // If player has an effect selected in hand and clicks a field monster, apply effect
    const clickedLocation = sprite && sprite.cardLocation ? sprite.cardLocation : 'hand';
    if(this.selectedCard && this.selectedCard.type==='effect' && this.selectedCardLocation==='hand' && card.type==='monster' && clickedLocation==='field' && this.phase==='effects'){
      // apply effect to target monster
      const idx = this.player.hand.findIndex(c=>c.id===this.selectedCard.id);
      if(idx>=0){
        const effectCard = this.selectedCard;
        this.player.hand.splice(idx,1);
        this.applyEffectCard(effectCard, card);
        this.selectedCard = null; this.selectedCardLocation = null;
        this.renderZoom(); this.renderAll();
        return;
      }
    }

    // Clicking your own field monster during the effects phase (with no effect selected)
    // activates its active ability, if it has one and hasn't been used this round.
    if(this.phase==='effects' && clickedLocation==='field' && card.type==='monster' && card.active && !card.activeUsed && !this.selectedCard){
      const isPlayerOwned = this.player.field.some(c=>c && c.id===card.id);
      if(isPlayerOwned){
        this.activateCard(this.player, card);
        return;
      }
    }

    // Otherwise select the clicked card
    this.selectedCard = card;
    this.selectedCardLocation = clickedLocation;
    this.renderZoom();
    this.renderAll();
  }

  onFieldSlotClicked(slotIndex){
    if(this.pendingDiscard) return; // must resolve the discard prompt first
    if(this.pendingPlacement){
      this.confirmPlacement(slotIndex);
      return;
    }
    if(this.phase==='place'){
      // place selected monster if any
      if(this.selectedCard && this.selectedCard.type==='monster' && this.selectedCardLocation === 'hand'){
        if(this.placeMonsterForOwner(this.player, this.selectedCard, slotIndex, null)){
          this.selectedCard=null; this.renderZoom();
        }
      }
    } else if(this.phase==='effects'){
      // if selected card is effect, apply to clicked player's monster if owned
      const m = this.player.field[slotIndex];
      if(this.selectedCard && this.selectedCard.type==='effect' && this.selectedCardLocation === 'hand' && m){
        // discard effect from hand and apply
        const idx = this.player.hand.findIndex(c=>c.id===this.selectedCard.id);
        if(idx>=0){
          const effectCard = this.selectedCard;
          this.player.hand.splice(idx,1);
          this.applyEffectCard(effectCard, m);
          this.selectedCard=null; this.renderZoom();
        }
      } else if(m && m.active && !m.activeUsed){
        this.activateCard(this.player, m);
      }
    }
    this.renderAll();
  }

  renderAll(){
    if(this.suspendRender) return; // avoid recreating while dragging
    // clear previous sprites
    this.handGroup.clear(true,true);
    this.botHandGroup.clear(true,true);
    // render player's hand
    const handSpacing = 118;
    const handStartX = WIDTH/2 - ((Math.max(this.player.hand.length, 1) - 1) * handSpacing) / 2;
    for(let i=0;i<this.player.hand.length;i++){
      const c = this.player.hand[i];
      const x = handStartX + i*handSpacing; const y = this.handY;
      // visual card
      const rect = this.add.rectangle(0,0,this.cardW-18,this.cardH-34,c.color).setStrokeStyle(2,0x111111);
      rect.setAlpha(0.95);
      const txt = this.add.text(-56,-84, c.name, {font:'15px Arial', fill:'#fff'});
      const tag = this.add.text(-46,-58, 'MÃO', {font:'12px Arial', fill:'#ffd47a'});
      const desc = this.add.text(-52,70, c.type === 'effect' ? 'Efeito' : 'Monstro', {font:'12px Arial', fill:'#fff'});
      // create an invisible hit zone to use as the draggable target
      const hit = this.add.zone(0,0,this.cardW-18,this.cardH-34).setRectangleDropZone(this.cardW-18,this.cardH-34).setInteractive();
      // container holds visuals and the hit zone
      const container = this.add.container(x,y, [rect, txt, tag, desc, hit]);
      container.setSize(this.cardW-18,this.cardH-34);
      // store card on the hit zone (the draggable object)
      hit.setData('card', c);
      hit.cardRef = c; hit.cardLocation = 'hand';
      // mark zone draggable
      this.input.setDraggable(hit);
      // clicking should select the card (use hit zone for clicks)
      hit.on('pointerdown', ()=>this.onCardClicked(c, container));
      container.cardRef = c;
      container.cardLocation = 'hand';
      this.handGroup.add(container);
    }
    // opponent hand - shown face-down; only the count is visible, not the cards themselves
    const botBackSpacing = 34;
    const botBackStartX = WIDTH/2 - ((Math.max(this.bot.hand.length, 1) - 1) * botBackSpacing) / 2;
    for(let i=0;i<this.bot.hand.length;i++){
      const x = botBackStartX + i*botBackSpacing; const y = this.botHandY;
      const back = this.add.rectangle(x,y,72,104,0x1c1c1c).setStrokeStyle(2,0x0c0c0c);
      this.botHandGroup.add(back);
    }
    if(this.bot.hand.length > 0){
      const countLabel = this.add.text(WIDTH/2, this.botHandY+70, `Mão do oponente: ${this.bot.hand.length}`, {font:'14px Arial', fill:'#cfd8dc'}).setOrigin(0.5,0);
      this.botHandGroup.add(countLabel);
    }

    // render field monsters
    // clear existing field sprites group
    if(this.fieldMonsters) this.fieldMonsters.clear(true,true);
    this.fieldMonsters = this.add.group();
    for(let i=0;i<3;i++){
      const x = this.fieldSlots[i].x;
      // opponent monster
      const om = this.bot.field[i];
      if(om){ const r = this.add.rectangle(x,this.opponentY,this.cardW,this.cardH,om.color).setStrokeStyle(3,0xe6a23c).setInteractive(); r.cardRef = om; r.cardLocation = 'field'; r.on('pointerdown', ()=>this.onCardClicked(om, r)); this.fieldMonsters.add(r); const t=this.add.text(x-60,this.opponentY-84, om.name, {font:'15px Arial', fill:'#081018'}); this.fieldMonsters.add(t); const tag=this.add.text(x-40,this.opponentY-58, 'CAMPO', {font:'12px Arial', fill:'#111'}); this.fieldMonsters.add(tag); const e=this.add.text(x-54,this.opponentY+70, `E:${this.cardEffectiveEnergy(om,this.bot)}`, {font:'14px Arial', fill:'#111'}); this.fieldMonsters.add(e);
        if(this.phase==='effects' && om.active){ const abilityTag = this.add.text(x+40,this.opponentY-84, om.activeUsed ? '✓' : '⚡', {font:'18px Arial', fill: om.activeUsed ? '#5a7080' : '#ffea00'}); this.fieldMonsters.add(abilityTag); }
      }
      // player monster
      const pm = this.player.field[i];
      if(pm){
        const isTributeSelected = !!(this.pendingTribute && this.pendingTribute.owner === this.player && this.pendingTribute.selectedIndices.includes(i));
        const strokeColor = isTributeSelected ? 0xffea00 : 0x7bdcff;
        const strokeSize = isTributeSelected ? 5 : 3;
        const r = this.add.rectangle(x,this.playerFieldY,this.cardW,this.cardH,pm.color).setStrokeStyle(strokeSize,strokeColor).setInteractive();
        r.cardRef = pm; r.cardLocation = 'field'; r.on('pointerdown', ()=>this.onCardClicked(pm, r));
        this.fieldMonsters.add(r);
        const t=this.add.text(x-60,this.playerFieldY-84, pm.name, {font:'15px Arial', fill:'#081018'}); this.fieldMonsters.add(t);
        const tag=this.add.text(x-40,this.playerFieldY-58, 'CAMPO', {font:'12px Arial', fill:'#111'}); this.fieldMonsters.add(tag);
        const e=this.add.text(x-54,this.playerFieldY+76, `E:${this.cardEffectiveEnergy(pm,this.player)}`, {font:'14px Arial', fill:'#111'}); this.fieldMonsters.add(e);
        if(this.phase==='effects' && pm.active){ const abilityTag = this.add.text(x+40,this.playerFieldY-84, pm.activeUsed ? '✓' : '⚡', {font:'18px Arial', fill: pm.activeUsed ? '#5a7080' : '#ffea00'}); this.fieldMonsters.add(abilityTag); }
      } else if(this.pendingPlacement && this.pendingPlacement.owner === this.player){
        // highlight empty slots available for the summoned monster
        const hint = this.add.rectangle(x,this.playerFieldY,this.cardW,this.cardH).setStrokeStyle(4,0xffea00).setFillStyle(0xffea00,0.08).setInteractive();
        hint.on('pointerdown', ()=>this.onFieldSlotClicked(i));
        this.fieldMonsters.add(hint);
      }
    }

    // info text
    this.infoText.setText(`Round ${this.round} • Phase: ${this.phase} • Your field energy: ${this.totalFieldEnergy(this.player)} • Bot: ${this.totalFieldEnergy(this.bot)}`);

    this.renderZoom();
  }

  renderZoom(){
    // render selected card to DOM
    if(!this.zoomDom) return;
    this.zoomDom.innerHTML = '';
    if(this.pendingDiscard){
      const pending = this.pendingDiscard;
      const div = document.createElement('div');
      div.className = 'zoom-card';
      div.innerHTML = `<h3>${pending.card.name}</h3><p><b>Escolha uma carta da mão para descartar</b></p><p>${pending.card.desc.replace(/\n/g,'<br/>')}</p>`;
      const listTitle = document.createElement('div');
      listTitle.innerHTML = '<strong>Sua mão:</strong>';
      div.appendChild(listTitle);
      pending.owner.hand.forEach((handCard, index)=>{
        const button = document.createElement('button');
        button.innerText = `Descartar ${handCard.name}`;
        button.onclick = ()=>this.confirmDiscardSelection(index);
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.marginTop = '6px';
        button.style.background = '#2b3c4a';
        button.style.color = '#fff';
        div.appendChild(button);
      });
      const actions = document.createElement('div');
      actions.style.marginTop = '12px';
      const cancel = document.createElement('button');
      cancel.innerText = 'Cancelar';
      cancel.onclick = ()=>this.cancelDiscardSelection();
      actions.appendChild(cancel);
      div.appendChild(actions);
      this.zoomDom.appendChild(div);
      return;
    }
    if(this.pendingPlacement){
      const pending = this.pendingPlacement;
      const div = document.createElement('div');
      div.className = 'zoom-card';
      div.innerHTML = `<h3>${pending.card.name}</h3><p><b>Escolha o quadrado onde o monstro vai nascer</b></p><p>${pending.card.desc.replace(/\n/g,'<br/>')}</p>`;
      const listTitle = document.createElement('div');
      listTitle.innerHTML = '<strong>Quadrados livres:</strong>';
      div.appendChild(listTitle);
      pending.owner.field.forEach((monster, index)=>{
        if(monster !== null) return;
        const button = document.createElement('button');
        button.innerText = `Posicionar no quadrado ${index+1}`;
        button.onclick = ()=>this.confirmPlacement(index);
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.marginTop = '6px';
        button.style.background = '#2b3c4a';
        button.style.color = '#fff';
        div.appendChild(button);
      });
      this.zoomDom.appendChild(div);
      return;
    }
    if(this.pendingTribute){
      const pending = this.pendingTribute;
      const div = document.createElement('div');
      div.className = 'zoom-card';
      div.innerHTML = `<h3>${pending.card.name}</h3><p><b>Escolha ${pending.tributeCost} cartas para tributar</b></p><p>${pending.card.desc.replace(/\n/g,'<br/>')}</p><p><b>Selecionadas:</b> ${pending.selectedIndices.length}/${pending.tributeCost}</p>`;
      const listTitle = document.createElement('div');
      listTitle.innerHTML = '<strong>Suas cartas em campo:</strong>';
      div.appendChild(listTitle);
      pending.owner.field.forEach((monster, index)=>{
        if(!monster) return;
        const button = document.createElement('button');
        const selected = pending.selectedIndices.includes(index);
        button.innerText = `${selected ? 'Desmarcar' : 'Tributar'} ${monster.name} (E:${this.cardEffectiveEnergy(monster, pending.owner)})`;
        button.onclick = ()=>this.toggleTributeSelection(index);
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.marginTop = '6px';
        button.style.background = selected ? '#ffcf3a' : '#2b3c4a';
        button.style.color = '#fff';
        div.appendChild(button);
      });
      const actions = document.createElement('div');
      actions.style.marginTop = '12px';
      const confirm = document.createElement('button');
      confirm.innerText = 'Confirmar tributo';
      confirm.disabled = pending.selectedIndices.length !== pending.tributeCost;
      confirm.onclick = ()=>this.confirmTributeSelection();
      const cancel = document.createElement('button');
      cancel.innerText = 'Cancelar';
      cancel.style.marginLeft = '8px';
      cancel.onclick = ()=>this.cancelTributeSelection();
      actions.appendChild(confirm);
      actions.appendChild(cancel);
      div.appendChild(actions);
      this.zoomDom.appendChild(div);
      return;
    }

    if(this.selectedCard){
      const div = document.createElement('div'); div.className='zoom-card';
      let locationLabel = 'Carta na mão';
      if(this.selectedCardLocation === 'field') locationLabel = 'Carta em campo';
      else if(this.selectedCardLocation === 'bot-hand') locationLabel = 'Carta na mão do oponente';
      div.innerHTML = `<h3>${this.selectedCard.name}</h3><p><b>${locationLabel}</b></p><p>${this.selectedCard.desc.replace(/\n/g,'<br/>')}</p><p><b>Energia:</b> ${this.selectedCard.baseEnergy}</p>`;
      if(this.selectedCard.type === 'monster'){
        const tributeInfo = document.createElement('p');
        tributeInfo.innerHTML = `<b>Estrelas:</b> ${this.selectedCard.stars || 0} • <b>Tributo:</b> ${this.getTributeCost(this.selectedCard)}`;
        div.appendChild(tributeInfo);
        if(this.selectedCard.active){
          const abilityP = document.createElement('p');
          abilityP.innerHTML = `<b>Habilidade ativa:</b> ${this.selectedCard.activeUsed ? 'já usada nesta rodada' : 'disponível na Fase de Efeitos'}`;
          div.appendChild(abilityP);
        }
      }
      if(this.phase==='effects' && this.selectedCard.type==='effect' && this.selectedCardLocation === 'hand'){
        const p = document.createElement('div'); p.innerText='Clique em um dos seus monstros para aplicar o efeito.'; div.appendChild(p);
      }
      this.zoomDom.appendChild(div);
    } else {
      const div = document.createElement('div'); div.className='zoom-card'; div.innerHTML='<em>Nenhuma carta selecionada</em><p>Clique em uma carta na sua mão para ver detalhes.</p>';
      this.zoomDom.appendChild(div);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: 'game-container',
  backgroundColor: '#0b2b3a',
  scene: [MainScene]
};

window.addEventListener('load', ()=>{
  const game = new Phaser.Game(config);
});