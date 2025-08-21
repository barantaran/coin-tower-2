// ==== CONFIGURATION ====
const CONFIG = {
  canvasWidth: 400,  // Base width for calculations
  canvasHeight: 600, // Base height for calculations
  aspectRatio: 600/400, // Height/Width ratio (1.5 - always vertical)
  minWidth: 300,     // Minimum canvas width
  maxWidth: 500,     // Maximum canvas width
  gravity: true,
  debugMode: false,
  friction: 20,
  coinRadius: 15,
  coinOverlapChance: 0.3,
  minInitialSpeed: 20,
  maxInitialSpeed: 100,
  tolerance: {
    minForceThreshold: 5,
    velocityDampingThreshold: 8,
    restingVelocityThreshold: 3,
    forceReductionFactor: 0.8,
    microMovementDamping: 0.95,
    pushForceDeadzone: 2,
  },
  spawnAreaHeightRatio: 0.25,
  tableHeightRatio: 0.4,
  floorHeightRatio: 0.1,
  pushRadius: 80,
  pushForce: 100,
  chainPushRadius: 60,
  chainPushReduction: 0.5,
  overlapAmountRange: [0.1, 0.3], // min–max factor for overlap randomness
};

class Vector2 {
  constructor(x=0,y=0){ this.x=x; this.y=y; }
  add(o){ return new Vector2(this.x+o.x,this.y+o.y); }
  subtract(o){ return new Vector2(this.x-o.x,this.y-o.y); }
  multiply(s){ return new Vector2(this.x*s,this.y*s); }
  magnitude(){ return Math.hypot(this.x,this.y); }
  normalize(){ const m=this.magnitude(); return m>0?new Vector2(this.x/m,this.y/m):new Vector2(); }
  distance(o){ return this.subtract(o).magnitude(); }
}

class Coin {
  constructor(x,y,r=CONFIG.coinRadius){
    this.position=new Vector2(x,y);
    this.velocity=new Vector2(0,0);
    this.radius=r;
    this.mass=Math.PI*r*r;
    this.color=this.randColor();
    this.isResting=false; this.restCounter=0;
    this.pushForce=0.5;
    this.canOverlap=Math.random()<CONFIG.coinOverlapChance;
    // uniform border thickness for all coins
    this.borderThickness = 2;
    // fixed overlap: always allow 1/3 diameter overlap
    this.overlapOffset= ( (this.radius*2 - this.radius*2/3) ) / (this.radius*2);
    // falling state machine
    this.isFalling=false;              // falling after table edge
    this.isSpawnAreaFalling=true;      // start falling immediately in spawn area
    this.justLanded=false;             // used to soften initial neighbor push
    // random stopping height within table area
    this.randomStoppingHeight = 0;     // will be set when coin is created
  }
  randColor(){ return ['#f39c12','#f1c40f','#e67e22'][Math.floor(Math.random()*3)]; }
  update(dt, canvas, tol, areas, useGravity){
    // spawn area gravity
    if (this.isSpawnAreaFalling && this.position.y < areas.spawnAreaHeight) {
      if (useGravity) this.velocity.y += 300*dt;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    // landed on table from spawn area at random height
    if (this.isSpawnAreaFalling && this.position.y >= this.randomStoppingHeight){
      this.isSpawnAreaFalling=false;
      this.velocity.y = Math.min(this.velocity.y*0.3, 50);
      this.isResting=false; this.restCounter=0;
      this.justLanded=true;
    }
    // normal table friction
    if (!this.isSpawnAreaFalling && !this.isFalling){
      this.velocity = this.velocity.multiply(Math.max(0, 1 - CONFIG.friction*dt));
      const speed=this.velocity.magnitude();
      if (speed < tol.velocityDampingThreshold && speed>0){
        this.velocity=this.velocity.multiply(tol.microMovementDamping);
        if (speed < tol.restingVelocityThreshold) this.velocity=new Vector2();
      }
    }
    // falling off table
    if (this.isFalling){ if (useGravity) this.velocity.y += 300*dt; this.velocity.y=Math.max(0,this.velocity.y); }

    this.velocity.y = Math.max(0, this.velocity.y); // no upward motion
    this.position = this.position.add(this.velocity.multiply(dt));

    // forbid coins to move above their random stopping height once they've landed
    if (!this.isSpawnAreaFalling && this.position.y < this.randomStoppingHeight + this.radius) {
      this.position.y = this.randomStoppingHeight + this.radius;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    this.handleBoundaries(canvas, areas);

    if (!this.isSpawnAreaFalling && !this.isFalling){
      if (this.velocity.magnitude() < tol.restingVelocityThreshold){
        if (++this.restCounter>30){ this.isResting=true; this.velocity=new Vector2(); }
      } else { this.restCounter=0; this.isResting=false; }
    }
  }
  handleBoundaries(canvas, areas){
    if (this.position.y - this.radius <= 0){
      this.position.y = this.radius; this.velocity.y=0; this.isResting=false; this.restCounter=0;
    }
    if (!this.isFalling){
      if (this.position.x - this.radius <= 0){ this.position.x=this.radius; this.velocity.x=Math.abs(this.velocity.x)*0.8; }
      if (this.position.x + this.radius >= canvas.width){ this.position.x=canvas.width-this.radius; this.velocity.x=-Math.abs(this.velocity.x)*0.8; }
    }
    if (!this.isFalling && this.position.y + this.radius >= areas.tableHeight){
      this.isFalling=true; this.isResting=false; this.restCounter=0;
    }
  }
  isOffscreen(c){ return this.position.y - this.radius > c.height + 100; }
  isCollidingWith(o){ return this.position.distance(o.position) < (this.radius + o.radius); }
  resolveCollision(o, tol){
    const d=this.position.distance(o.position); const minD=this.radius+o.radius; if (d>=minD||d===0) return;
    const normal = o.position.subtract(this.position).normalize();
    const overlap = minD - d; const canOverlap = this.canOverlap || o.canOverlap;
    if (canOverlap){
      // fixed overlap: allow always one third of diameter penetration
      const allowed=minD - (this.radius*2/3);
      if (d>=allowed) return;
    }
    if (canOverlap){
      // Let overlappable coins keep sinking with only small correction
      if (overlap > 0){
        const sep = normal.multiply(overlap*0.1);
        this.position=this.position.subtract(sep);
        o.position=o.position.add(sep);
      }
    } else if (overlap > tol.pushForceDeadzone){
      const sep = normal.multiply(overlap*0.5);
      this.position=this.position.subtract(sep);
      o.position=o.position.add(sep);
    }

    const relV = o.velocity.subtract(this.velocity);
    const vN = relV.x*normal.x + relV.y*normal.y;
    if (vN>0 || Math.abs(vN)<tol.minForceThreshold) return;
    const restitution = canOverlap ? 0.05 : 0.4;
    const impulseMult = canOverlap ? 0.05 : tol.forceReductionFactor;
    let j = -(1+restitution)*vN*impulseMult; j /= (1/this.mass + 1/o.mass);
    if (Math.abs(j) > tol.minForceThreshold){
      const J = normal.multiply(j);
      this.velocity = this.velocity.subtract(J.multiply(1/this.mass));
      o.velocity = o.velocity.add(J.multiply(1/o.mass));
      this.velocity.y=Math.max(0,this.velocity.y); o.velocity.y=Math.max(0,o.velocity.y);
      this.restCounter=0; o.restCounter=0; this.isResting=false; o.isResting=false;
    }
    if (!canOverlap && overlap > tol.pushForceDeadzone){
      let n = normal.y <= 0 ? new Vector2(normal.x, Math.abs(normal.y)).normalize() : normal;
      const pushF = this.pushForce*50*tol.forceReductionFactor;
      if (pushF > tol.minForceThreshold){
        const push = n.multiply(pushF);
        o.velocity = o.velocity.add(push); o.velocity.y=Math.max(0,o.velocity.y);
      }
    }
  }
  draw(ctx){
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,.2)'; ctx.beginPath(); ctx.arc(this.position.x+2,this.position.y+2,this.radius,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(this.position.x,this.position.y,this.radius,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=this.canOverlap?'#1a252f':'#2c3e50'; 
    ctx.lineWidth=this.borderThickness; 
    ctx.stroke();
    const g=ctx.createRadialGradient(this.position.x - this.radius*0.3, this.position.y - this.radius*0.3, 0, this.position.x, this.position.y, this.radius);
    g.addColorStop(0,'rgba(255,255,255,.6)'); g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(this.position.x,this.position.y,this.radius,0,Math.PI*2); ctx.fill();
    if (this.canOverlap){ ctx.globalAlpha=1; ctx.fillStyle='rgba(255,255,0,.8)'; ctx.beginPath(); ctx.arc(this.position.x, this.position.y - this.radius*.6, 3, 0, Math.PI*2); ctx.fill(); }
    if (CONFIG.debugMode && this.velocity.magnitude()>5){ ctx.globalAlpha=1; ctx.strokeStyle='red'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(this.position.x,this.position.y); const end=this.position.add(this.velocity.multiply(.1)); ctx.lineTo(end.x,end.y); ctx.stroke(); }
    ctx.restore();
  }
}

class CoinSimulation {
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d');
    this.coins=[]; this.lastTime=0; this.useGravity=CONFIG.gravity;
    
    // Initialize responsive canvas
    this.setupResponsiveCanvas();
    
    // Auto-spawn properties
    this.autoSpawn = false;
    this.autoSpawnInterval = 35; // Much faster spawning - 50ms between spawns
    this.lastAutoSpawn = 0;
    this.autoSpawnComplete = false;
    this.bottomThreshold = 0.8; // 90% down the table area
    const c=canvas;
    this.areas={
      get spawnAreaHeight(){ return c.height*CONFIG.spawnAreaHeightRatio; },
      get tableHeight(){ return this.spawnAreaHeight + (c.height*CONFIG.tableHeightRatio); },
      get floorHeight(){ return c.height*CONFIG.floorHeightRatio; },
      get fallingSpaceTop(){ return this.tableHeight; },
      get fallingSpaceHeight(){ return c.height - this.tableHeight - this.floorHeight; },
      get floorTop(){ return c.height - this.floorHeight; },
    };
    this.tol = CONFIG.tolerance;
    canvas.addEventListener('click', e=>this.onClick(e));
  }
  
  setupResponsiveCanvas() {
    // Calculate and set initial canvas size
    this.updateCanvasSize();
    
    // Set up resize listener
    window.addEventListener('resize', () => this.updateCanvasSize());
  }
  
  calculateResponsiveSize() {
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate available space (accounting for padding and UI)
    const availableWidth = Math.min(viewportWidth * 0.9, CONFIG.maxWidth);
    const availableHeight = viewportHeight * 0.8;
    
    // Calculate width based on available space but maintain vertical aspect ratio
    let canvasWidth = Math.max(CONFIG.minWidth, Math.min(availableWidth, CONFIG.maxWidth));
    let canvasHeight = canvasWidth * CONFIG.aspectRatio;
    
    // If height exceeds available space, scale down proportionally
    if (canvasHeight > availableHeight) {
      canvasHeight = availableHeight;
      canvasWidth = canvasHeight / CONFIG.aspectRatio;
      
      // Ensure width doesn't go below minimum
      if (canvasWidth < CONFIG.minWidth) {
        canvasWidth = CONFIG.minWidth;
        canvasHeight = canvasWidth * CONFIG.aspectRatio;
      }
    }
    
    return {
      width: Math.floor(canvasWidth),
      height: Math.floor(canvasHeight)
    };
  }
  
  updateCanvasSize() {
    const { width, height } = this.calculateResponsiveSize();
    
    // Only update if size has changed significantly (avoid unnecessary updates)
    if (Math.abs(this.canvas.width - width) > 5 || Math.abs(this.canvas.height - height) > 5) {
      const oldWidth = this.canvas.width;
      const oldHeight = this.canvas.height;
      
      // Update canvas dimensions
      this.canvas.width = width;
      this.canvas.height = height;
      
      // Scale existing coin positions to new canvas size
      this.scaleCoins(oldWidth, oldHeight, width, height);
    }
  }
  
  scaleCoins(oldWidth, oldHeight, newWidth, newHeight) {
    if (this.coins.length === 0) return;
    
    const scaleX = newWidth / oldWidth;
    const scaleY = newHeight / oldHeight;
    
    // Scale all coin positions and velocities
    for (const coin of this.coins) {
      coin.position.x *= scaleX;
      coin.position.y *= scaleY;
      coin.velocity.x *= scaleX;
      coin.velocity.y *= scaleY;
      coin.randomStoppingHeight *= scaleY;
    }
  }
  onClick(e){
    const r=this.canvas.getBoundingClientRect();
    // Spawn coins in the upper left corner
    const x = CONFIG.coinRadius + Math.random() * 50; // Small area in upper left
    const y = CONFIG.coinRadius + Math.random() * 50; // Small area in upper left
    const coin=new Coin(x,y);
    // Set random stopping height within upper 2/3 of table area
    const tableAreaHeight = this.areas.tableHeight - this.areas.spawnAreaHeight;
    const upperTwoThirdsHeight = tableAreaHeight * 0.33;
    coin.randomStoppingHeight = this.areas.spawnAreaHeight + Math.random() * upperTwoThirdsHeight;
    // Random vector pointing to the right (angle between -30° to +30° from horizontal right)
    const angle = (Math.random() - 0.5) * Math.PI/3; // -π/6 to +π/6 (-30° to +30°)
    const speed = Math.random() * 300 + 50; // Speed range from 50 to 200 for more variety
    coin.velocity = new Vector2(Math.cos(angle)*speed, Math.sin(angle)*speed);
    coin.justLanded=true; // soften initial neighbor push
    this.coins.push(coin);
    this.applyNeighborPush(coin);
  }
  applyNeighborPush(seed){
    for (const coin of this.coins){ if (coin===seed) continue;
      const d=seed.position.distance(coin.position); if (d<CONFIG.pushRadius && d>0){
        const raw = coin.position.subtract(seed.position).normalize();
        const dir = raw.y <= 0 ? new Vector2(raw.x, Math.abs(raw.y)).normalize() : raw;
        const mult = seed.justLanded ? 0.2 : 1.0;
        const force = ((CONFIG.pushRadius - d)/CONFIG.pushRadius) * CONFIG.pushForce * mult;
        const dv = dir.multiply(force);
        coin.velocity = coin.velocity.add(dv); coin.velocity.y=Math.max(0,coin.velocity.y); coin.isResting=false; coin.restCounter=0;
        this.chainPush(coin, dir.multiply(force*(1-CONFIG.chainPushReduction)));
      }
    }
    seed.justLanded=false;
  }
  chainPush(coin, base){
    for (const other of this.coins){ if (other===coin) continue;
      const d=coin.position.distance(other.position); if (d<CONFIG.chainPushRadius && d>0){
        const raw = other.position.subtract(coin.position).normalize();
        const dir = raw.y <= 0 ? new Vector2(raw.x, Math.abs(raw.y)).normalize() : raw;
        const dv = dir.multiply(base.magnitude()*CONFIG.chainPushReduction);
        other.velocity = other.velocity.add(dv); other.velocity.y=Math.max(0,other.velocity.y); other.isResting=false; other.restCounter=0;
      }
    }
  }
  
  spawnCoin(x, y) {
    const coin = new Coin(x, y);
    // Set random stopping height within upper 2/3 of table area
    const tableAreaHeight = this.areas.tableHeight - this.areas.spawnAreaHeight;
    const upperTwoThirdsHeight = tableAreaHeight * 0.33;
    coin.randomStoppingHeight = this.areas.spawnAreaHeight + Math.random() * upperTwoThirdsHeight;
    // Random angle and speed
    const angle = Math.random() * Math.PI; // 0..π gives positive Y
    const speed = Math.random() * (CONFIG.maxInitialSpeed - CONFIG.minInitialSpeed) + CONFIG.minInitialSpeed;
    coin.velocity = new Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed);
    coin.justLanded = true;
    this.coins.push(coin);
    this.applyNeighborPush(coin);
    return coin;
  }
  
  autoSpawnCoin() {
    // Spawn at center of spawn area only
    const x = this.canvas.width / 2;
    const y = this.areas.spawnAreaHeight / 2;
    return this.spawnCoin(x, y);
  }
  
  checkBottomReached() {
    if (this.autoSpawnComplete) return true;
    
    const tableAreaHeight = this.areas.tableHeight - this.areas.spawnAreaHeight;
    const bottomThresholdY = this.areas.spawnAreaHeight + (tableAreaHeight * this.bottomThreshold);
    
    for (const coin of this.coins) {
      // Check if any coin that has landed on the table is near the bottom
      if (!coin.isSpawnAreaFalling && !coin.isFalling && 
          coin.position.y + coin.radius >= bottomThresholdY) {
        return true;
      }
    }
    return false;
  }
  
  startAutoSpawn() {
    this.autoSpawn = true;
    this.autoSpawnComplete = false;
    this.lastAutoSpawn = performance.now();
  }
  
  stopAutoSpawn() {
    this.autoSpawn = false;
  }
  animate(t){
    const dt=Math.min((t-this.lastTime)/1000, 1/30); this.lastTime=t;
    
    // Auto-spawn logic
    if (this.autoSpawn && !this.autoSpawnComplete) {
      // Check if we should spawn a new coin
      if (t - this.lastAutoSpawn >= this.autoSpawnInterval) {
        this.autoSpawnCoin();
        this.lastAutoSpawn = t;
      }
      
      // Check if any coin has reached the bottom threshold
      if (this.checkBottomReached()) {
        this.autoSpawn = false;
        this.autoSpawnComplete = true;
        console.log('Auto-spawn complete! A coin has reached near the bottom of the table.');
      }
    }
    
    const ctx=this.ctx; ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.drawAreas();
    for (const c of this.coins){ c.update(dt,this.canvas,this.tol,this.areas,this.useGravity); }
    this.coins = this.coins.filter(c=>!c.isOffscreen(this.canvas));
    for (let i=0;i<this.coins.length;i++) for (let j=i+1;j<this.coins.length;j++){
      const a=this.coins[i], b=this.coins[j];
      // skip collision resolution when coins are falling (either in spawn area or off table)
      if (a.isFalling||b.isFalling||a.isSpawnAreaFalling||b.isSpawnAreaFalling) continue;
      if (a.isCollidingWith(b)) a.resolveCollision(b,this.tol);
    }
    for (const c of this.coins){ c.draw(ctx); }
    
    requestAnimationFrame(this.animate.bind(this));
  }
  drawAreas(){
    const ctx=this.ctx; const A=this.areas; const c=this.canvas;
    ctx.fillStyle='rgba(255,182,193,.3)'; ctx.fillRect(0,0,c.width,A.spawnAreaHeight);
    ctx.fillStyle='rgba(255,105,180,.8)'; ctx.fillRect(0, A.spawnAreaHeight-5, c.width, 5);
    ctx.fillStyle='rgba(139,69,19,.3)'; ctx.fillRect(0, A.spawnAreaHeight, c.width, c.height*CONFIG.tableHeightRatio);
    ctx.fillStyle='rgba(101,67,33,.8)'; ctx.fillRect(0, A.tableHeight-8, c.width, 8);
    ctx.fillStyle='rgba(135,206,235,.1)'; ctx.fillRect(0, A.tableHeight, c.width, A.fallingSpaceHeight);
    ctx.fillStyle='rgba(105,105,105,.4)'; ctx.fillRect(0, A.floorTop, c.width, A.floorHeight);
    ctx.fillStyle='rgba(70,70,70,.8)'; ctx.fillRect(0, A.floorTop, c.width, 5);
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.font='12px system-ui'; ctx.textAlign='center';
    ctx.fillText('SPAWN AREA', c.width/2, A.spawnAreaHeight/2);
    ctx.fillText('(Click anywhere to spawn coins)', c.width/2, A.spawnAreaHeight/2 + 15);
    const tableMid=A.spawnAreaHeight + (c.height*CONFIG.tableHeightRatio)/2; ctx.fillText('TABLE', c.width/2, tableMid);
    ctx.fillText('FALLING SPACE', c.width/2, A.tableHeight + A.fallingSpaceHeight/2);
    ctx.fillText('FLOOR', c.width/2, A.floorTop + A.floorHeight/2);
  }
}

let sim;
window.addEventListener('load', ()=>{
  const canvas=document.getElementById('gameCanvas');
  sim=new CoinSimulation(canvas);
  requestAnimationFrame(sim.animate.bind(sim));
  
  // Start auto-spawn immediately on load
  sim.startAutoSpawn();
  
  // UI
  const clearBtn=document.getElementById('clearBtn');
  const autoSpawnBtn=document.getElementById('autoSpawnBtn');
  const gravityChk=document.getElementById('gravityChk');
  
  // Update button text to reflect that auto-spawn is already running
  autoSpawnBtn.textContent = 'Stop Auto-Spawn';
  
  clearBtn.addEventListener('click',()=>{ 
    sim.coins.length=0; 
    sim.stopAutoSpawn();
    sim.autoSpawnComplete = false;
    autoSpawnBtn.textContent = 'Start Auto-Spawn';
  });
  
  autoSpawnBtn.addEventListener('click',()=>{
    if (sim.autoSpawn) {
      sim.stopAutoSpawn();
      autoSpawnBtn.textContent = 'Start Auto-Spawn';
    } else {
      sim.startAutoSpawn();
      autoSpawnBtn.textContent = 'Stop Auto-Spawn';
    }
  });
  
  gravityChk.addEventListener('change',()=>{ sim.useGravity = gravityChk.checked; });
});
