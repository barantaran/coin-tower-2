// CONFIGURATION - Edit these values to customize the simulation
const CONFIG = {
    // Canvas dimensions
    canvasWidth: 400,
    canvasHeight: 600,
    
    // Physics settings
    gravity: true,
    friction: 20,
    
    // Coin settings
    coinRadius: 15,
    coinOverlapChance: 0.3, // 30% chance for coins to overlap
    
    // Initial velocity range when spawning coins
    minInitialSpeed: 20,
    maxInitialSpeed: 100,
    
    // Physics tolerance settings
    tolerance: {
        minForceThreshold: 5,
        velocityDampingThreshold: 8,
        restingVelocityThreshold: 3,
        forceReductionFactor: 0.8,
        microMovementDamping: 0.95,
        pushForceDeadzone: 2
    },
    
    // Area proportions (as fractions of canvas height)
    spawnAreaHeightRatio: 0.25,  // Spawn/falling area is 25% of canvas height
    tableHeightRatio: 0.4,  // Table area is 40% of canvas height
    floorHeightRatio: 0.1,  // Floor area is 10% of canvas height
    
    // Neighbor push settings
    pushRadius: 80,
    pushForce: 100,
    chainPushRadius: 60,
    chainPushReduction: 0.5
};

class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    
    add(other) {
        return new Vector2(this.x + other.x, this.y + other.y);
    }
    
    subtract(other) {
        return new Vector2(this.x - other.x, this.y - other.y);
    }
    
    multiply(scalar) {
        return new Vector2(this.x * scalar, this.y * scalar);
    }
    
    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    
    normalize() {
        const mag = this.magnitude();
        return mag > 0 ? new Vector2(this.x / mag, this.y / mag) : new Vector2(0, 0);
    }
    
    distance(other) {
        return this.subtract(other).magnitude();
    }
}

class Coin {
    constructor(x, y, radius = CONFIG.coinRadius) {
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(0, 0);
        this.radius = radius;
        this.mass = Math.PI * radius * radius; // Mass proportional to area
        this.color = this.generateRandomColor();
        this.isResting = false;
        this.restCounter = 0;
        this.pushForce = 0.5; // Force applied when pushing neighbors
        this.canOverlap = Math.random() < CONFIG.coinOverlapChance;
        this.isFalling = false; // Track if coin is falling after hitting floor
        this.isSpawnAreaFalling = true; // Start falling immediately when spawned in spawn area
        this.settleTime = Math.random() * 2 + 1; // Random time (1-3 seconds) before settling on table
        this.fallStartTime = 0; // When the coin started falling from spawn area
        this.justLanded = false; // Track if coin just landed from spawn area
        this.landedTime = 0; // When the coin landed
    }
    
    generateRandomColor() {
        const colors = [
            '#f39c12', '#f1c40f', '#e67e22'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    update(deltaTime, gravity, friction, canvas, tolerance, areas, currentTime) {
        // Handle spawn area falling logic
        if (this.position.y < areas.spawnAreaHeight && !this.isSpawnAreaFalling) {
            // Coin is in spawn area, check if it's time to start falling
            if (this.fallStartTime === 0) {
                this.fallStartTime = currentTime;
            }
            
            const timeFalling = (currentTime - this.fallStartTime) / 1000; // Convert to seconds
            if (timeFalling >= this.settleTime) {
                // Time to start falling - apply gravity and disable friction
                this.isSpawnAreaFalling = true;
            } else {
                // Still in spawn area, apply friction to slow movement
                this.velocity = this.velocity.multiply(1 - friction * deltaTime);
            }
        }
        
        // Apply gravity while falling from spawn area
        if (this.isSpawnAreaFalling && this.position.y < areas.spawnAreaHeight) {
            this.velocity.y += 300 * deltaTime; // Continue applying gravity while falling
            // Ensure Y velocity is always positive (downward)
            this.velocity.y = Math.max(0, this.velocity.y);
        }
        
        // Check if coin has reached the table area from spawn area
        if (this.isSpawnAreaFalling && this.position.y >= areas.spawnAreaHeight) {
            // Coin has left spawn area and is now on table - stop falling, enable friction
            this.isSpawnAreaFalling = false;
            this.velocity.y = Math.min(this.velocity.y * 0.3, 50); // Dampen velocity but allow some bounce
            this.isResting = false;
            this.restCounter = 0;
            this.justLanded = true; // Mark as just landed
            this.landedTime = currentTime; // Record when it landed
        } else if (this.isFalling) {
            // Coin is falling off the table (normal falling behavior)
            this.velocity.y += 300 * deltaTime; // Gravity acceleration
            // Ensure Y velocity is always positive (downward)
            this.velocity.y = Math.max(0, this.velocity.y);
        } else if (!this.isSpawnAreaFalling && !this.isFalling) {
            // Normal table physics - apply friction
            this.velocity = this.velocity.multiply(1 - friction * deltaTime);
        }
        
        // Clear justLanded flag after 1 second to restore normal push behavior
        if (this.justLanded && this.landedTime > 0) {
            const timeSinceLanding = (currentTime - this.landedTime) / 1000; // Convert to seconds
            if (timeSinceLanding >= 1.0) { // 1 second grace period
                this.justLanded = false;
            }
        }
        
        // Apply tolerance-based velocity damping to prevent jittering (only when not falling)
        if (!this.isSpawnAreaFalling && !this.isFalling) {
            const currentSpeed = this.velocity.magnitude();
            if (currentSpeed < tolerance.velocityDampingThreshold && currentSpeed > 0) {
                // Apply extra damping for small velocities
                this.velocity = this.velocity.multiply(tolerance.microMovementDamping);
                
                // Stop very small movements entirely
                if (currentSpeed < tolerance.restingVelocityThreshold) {
                    this.velocity = new Vector2(0, 0);
                }
            }
        }
        
        // Constrain velocity to 3rd and 4th quarters (downward movement only)
        // Y velocity must always be >= 0 (downward or stationary)
        this.velocity.y = Math.max(0, this.velocity.y);
        
        // Update position
        this.position = this.position.add(this.velocity.multiply(deltaTime));
        
        // Boundary collisions
        this.handleBoundaryCollisions(canvas, areas);
        
        // Check if coin is resting (using tolerance threshold, only when not falling)
        if (!this.isSpawnAreaFalling && !this.isFalling) {
            if (this.velocity.magnitude() < tolerance.restingVelocityThreshold) {
                this.restCounter++;
                if (this.restCounter > 30) { // 30 frames of low velocity
                    this.isResting = true;
                    this.velocity = new Vector2(0, 0);
                }
            } else {
                this.restCounter = 0;
                this.isResting = false;
            }
        }
    }
    
    handleBoundaryCollisions(canvas, areas) {
        // Handle table area top boundary - prevent upward movement
        if (this.position.y - this.radius <= 0) {
            this.position.y = this.radius;
            this.velocity.y = 0; // Stop upward movement completely
            this.isResting = false;
            this.restCounter = 0;
        }
        
        // Handle side walls - bounce in all areas except when falling
        if (!this.isFalling) {
            if (this.position.x - this.radius <= 0) {
                this.position.x = this.radius;
                this.velocity.x = Math.abs(this.velocity.x) * 0.8;
            }
            
            if (this.position.x + this.radius >= canvas.width) {
                this.position.x = canvas.width - this.radius;
                this.velocity.x = -Math.abs(this.velocity.x) * 0.8;
            }
        }
        
        // Handle transition from table to falling space - start falling immediately
        if (!this.isFalling && this.position.y + this.radius >= areas.tableHeight) {
            this.isFalling = true; // Start falling as soon as coin leaves table
            this.isResting = false;
            this.restCounter = 0;
        }
        
        // For falling coins, allow them to pass through all boundaries
        // They will be removed when they go offscreen
    }
    
    // Check if coin is offscreen (for destruction)
    isOffscreen(canvas) {
        return (
            this.position.y - this.radius > canvas.height + 100 ||  // Below screen
            this.position.y + this.radius < -100 ||                 // Above screen
            this.position.x - this.radius > canvas.width + 100 ||   // Right of screen
            this.position.x + this.radius < -100                    // Left of screen
        );
    }
    
    // Check collision with another coin
    isCollidingWith(other) {
        const distance = this.position.distance(other.position);
        return distance < (this.radius + other.radius);
    }
    
    // Resolve collision and push neighbors with tolerance
    resolveCollision(other, tolerance) {
        const distance = this.position.distance(other.position);
        const minDistance = this.radius + other.radius;
        
        if (distance < minDistance && distance > 0) {
            // Check if either coin can overlap
            const canOverlapCollision = this.canOverlap || other.canOverlap;
            
            // Calculate collision normal
            const normal = other.position.subtract(this.position).normalize();
            
            // Only separate coins if neither can overlap and the overlap is significant
            const overlap = minDistance - distance;
            if (!canOverlapCollision && overlap > tolerance.pushForceDeadzone) {
                // Separate overlapping coins
                const separation = normal.multiply(overlap * 0.5);
                
                this.position = this.position.subtract(separation);
                other.position = other.position.add(separation);
            }
            
            // Calculate relative velocity
            const relativeVelocity = other.velocity.subtract(this.velocity);
            const velocityAlongNormal = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y;
            
            // Don't resolve if velocities are separating or force is too small
            if (velocityAlongNormal > 0 || Math.abs(velocityAlongNormal) < tolerance.minForceThreshold) return;
            
            // For overlapping coins, greatly reduce the collision response
            const restitution = canOverlapCollision ? 0.05 : 0.4;
            const impulseMult = canOverlapCollision ? 0.1 : tolerance.forceReductionFactor;
            
            // Calculate impulse scalar
            let impulse = -(1 + restitution) * velocityAlongNormal * impulseMult;
            impulse /= (1/this.mass + 1/other.mass);
            
            // Apply tolerance threshold - only apply impulse if it's significant enough
            if (Math.abs(impulse) > tolerance.minForceThreshold) {
                // Apply impulse (reduced for overlapping coins)
                const impulseVector = normal.multiply(impulse);
                this.velocity = this.velocity.subtract(impulseVector.multiply(1/this.mass));
                other.velocity = other.velocity.add(impulseVector.multiply(1/other.mass));
                
                // Constrain velocities to downward movement only after collision
                this.velocity.y = Math.max(0, this.velocity.y);
                other.velocity.y = Math.max(0, other.velocity.y);
            }
            
            // For overlapping coins, skip the push force entirely to prevent unwanted pushing
            if (!canOverlapCollision && overlap > tolerance.pushForceDeadzone) {
                // Add push force only for normal coins and only if force is significant
                const pushForce = this.pushForce * 50 * tolerance.forceReductionFactor;
                if (pushForce > tolerance.minForceThreshold) {
                    // Constrain push direction to 3rd and 4th quarters (downward only)
                    // 3rd quarter: π to 3π/2 (180° to 270°) - down and left
                    // 4th quarter: 3π/2 to 2π (270° to 360°) - down and right
                    let constrainedNormal;
                    if (normal.y <= 0) {
                        // If normal direction is upward, redirect to downward
                        // Preserve X direction but force Y to be positive (downward)
                        constrainedNormal = new Vector2(normal.x, Math.abs(normal.y)).normalize();
                    } else {
                        // Already downward, use as is
                        constrainedNormal = normal;
                    }
                    
                    const pushDirection = constrainedNormal.multiply(pushForce);
                    other.velocity = other.velocity.add(pushDirection);
                    
                    // Ensure velocity stays in 3rd and 4th quarters (downward only)
                    other.velocity.y = Math.max(0, other.velocity.y);
                }
            }
            
            // Reset rest counters since coins are moving (only if significant movement occurred)
            if (Math.abs(impulse) > tolerance.minForceThreshold) {
                this.restCounter = 0;
                other.restCounter = 0;
                this.isResting = false;
                other.isResting = false;
            }
        }
    }
    
    draw(ctx) {
        ctx.save();
        
        // Draw coin shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.arc(this.position.x + 2, this.position.y + 2, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw coin body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw coin border (slightly thicker for overlapping coins to make them more visible)
        ctx.strokeStyle = this.canOverlap ? '#1a252f' : '#2c3e50';
        ctx.lineWidth = this.canOverlap ? 3 : 2;
        ctx.stroke();
        
        // Draw coin highlight
        const gradient = ctx.createRadialGradient(
            this.position.x - this.radius * 0.3, 
            this.position.y - this.radius * 0.3, 
            0,
            this.position.x, 
            this.position.y, 
            this.radius
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw special indicator for overlapping coins
        if (this.canOverlap) {
            ctx.globalAlpha = 1.0; // Reset alpha for indicator
            ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.beginPath();
            ctx.arc(this.position.x, this.position.y - this.radius * 0.6, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw velocity indicator (for debugging)
        if (this.velocity.magnitude() > 5) {
            ctx.globalAlpha = 1.0; // Reset alpha for velocity indicator
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.position.x, this.position.y);
            const velocityEnd = this.position.add(this.velocity.multiply(0.1));
            ctx.lineTo(velocityEnd.x, velocityEnd.y);
            ctx.stroke();
        }
        
        ctx.restore();
    }
}

class CoinSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.coins = [];
        this.gravity = CONFIG.gravity;
        this.friction = CONFIG.friction;
        this.lastTime = 0;
        
        // Set canvas dimensions from config
        this.canvas.width = CONFIG.canvasWidth;
        this.canvas.height = CONFIG.canvasHeight;
        
        // Define the four areas using config ratios
        this.areas = {
            get spawnAreaHeight() { return canvas.height * CONFIG.spawnAreaHeightRatio; },
            get tableHeight() { return this.spawnAreaHeight + (canvas.height * CONFIG.tableHeightRatio); },
            get floorHeight() { return canvas.height * CONFIG.floorHeightRatio; },
            get fallingSpaceTop() { return this.tableHeight; },
            get fallingSpaceHeight() { return canvas.height - this.tableHeight - this.floorHeight; },
            get floorTop() { return canvas.height - this.floorHeight; }
        };
        
        // Use tolerance settings from config
        this.tolerance = CONFIG.tolerance;
        
        // Bind event listeners
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        
        // Start animation loop
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }
    
    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Only allow coin spawning in the spawn area (top area)
        if (y >= this.areas.spawnAreaHeight) {
            return; // Don't spawn coins outside the spawn area
        }
        
        // Create new coin at click position (constrained to spawn area)
        const newCoin = new Coin(x, y);
        
        // Give it a random initial velocity only in 3rd and 4th quarters (downward direction)
        // 3rd quarter: π to 3π/2 (180° to 270°) - down and left
        // 4th quarter: 3π/2 to 2π (270° to 360°) - down and right
        const angle = Math.random() * Math.PI + Math.PI; // Random angle from π to 2π
        const speed = Math.random() * (CONFIG.maxInitialSpeed - CONFIG.minInitialSpeed) + CONFIG.minInitialSpeed;
        newCoin.velocity = new Vector2(
            Math.cos(angle) * speed,  // X component
            Math.sin(angle) * speed   // Y component (will always be negative, ensuring downward movement)
        );
        
        this.coins.push(newCoin);
        
        // Apply immediate push forces to nearby coins
        this.applyNeighborPush(newCoin);
    }
    
    applyNeighborPush(newCoin) {        
        for (const coin of this.coins) {
            if (coin === newCoin) continue;
            
            const distance = newCoin.position.distance(coin.position);
            if (distance < CONFIG.pushRadius && distance > 0) {
                // Calculate initial push direction
                const rawDirection = coin.position.subtract(newCoin.position).normalize();
                
                // Constrain push direction to 3rd and 4th quarters (downward only)
                // 3rd quarter: π to 3π/2 (180° to 270°) - down and left
                // 4th quarter: 3π/2 to 2π (270° to 360°) - down and right
                let pushDirection;
                if (rawDirection.y <= 0) {
                    // If direction is upward, redirect to downward
                    // Preserve X direction but force Y to be positive (downward)
                    pushDirection = new Vector2(rawDirection.x, Math.abs(rawDirection.y)).normalize();
                } else {
                    // Already downward, use as is
                    pushDirection = rawDirection;
                }
                
                // Reduce push force significantly for coins that just fell from spawn area
                let forceMultiplier = 1.0;
                if (newCoin.justLanded) {
                    forceMultiplier = 0.2; // Much gentler push for coins that just landed
                }
                
                // Apply force inversely proportional to distance
                const force = (CONFIG.pushRadius - distance) / CONFIG.pushRadius * CONFIG.pushForce * forceMultiplier;
                const pushVelocity = pushDirection.multiply(force);
                
                coin.velocity = coin.velocity.add(pushVelocity);
                // Ensure velocity stays in 3rd and 4th quarters (downward only)
                coin.velocity.y = Math.max(0, coin.velocity.y);
                coin.isResting = false;
                coin.restCounter = 0;
                
                // Create chain reaction by checking this coin's neighbors (also reduced for landed coins)
                this.chainPush(coin, pushDirection.multiply(force * (1 - CONFIG.chainPushReduction)));
            }
        }
    }
    
    chainPush(coin, originalForce) {        
        for (const otherCoin of this.coins) {
            if (otherCoin === coin) continue;
            
            const distance = coin.position.distance(otherCoin.position);
            if (distance < CONFIG.chainPushRadius && distance > 0) {
                // Calculate initial push direction
                const rawDirection = otherCoin.position.subtract(coin.position).normalize();
                
                // Constrain push direction to 3rd and 4th quarters (downward only)
                // 3rd quarter: π to 3π/2 (180° to 270°) - down and left
                // 4th quarter: 3π/2 to 2π (270° to 360°) - down and right
                let pushDirection;
                if (rawDirection.y <= 0) {
                    // If direction is upward, redirect to downward
                    // Preserve X direction but force Y to be positive (downward)
                    pushDirection = new Vector2(rawDirection.x, Math.abs(rawDirection.y)).normalize();
                } else {
                    // Already downward, use as is
                    pushDirection = rawDirection;
                }
                
                // Reduce force for chain reaction and apply directional constraint
                const reducedForce = pushDirection.multiply(originalForce.magnitude() * CONFIG.chainPushReduction);
                otherCoin.velocity = otherCoin.velocity.add(reducedForce);
                // Ensure velocity stays in 3rd and 4th quarters (downward only)
                otherCoin.velocity.y = Math.max(0, otherCoin.velocity.y);
                otherCoin.isResting = false;
                otherCoin.restCounter = 0;
            }
        }
    }
    
    animate(currentTime) {
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 1/30); // Cap at 30 FPS
        this.lastTime = currentTime;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw the areas background
        this.drawAreas();
        
        // Update all coins with tolerance and areas
        for (const coin of this.coins) {
            coin.update(deltaTime, this.gravity, this.friction, this.canvas, this.tolerance, this.areas, currentTime);
        }
        
        // Remove offscreen coins (those that have fallen off)
        this.coins = this.coins.filter(coin => !coin.isOffscreen(this.canvas));
        
        // Handle collisions between coins with tolerance (skip falling coins)
        for (let i = 0; i < this.coins.length; i++) {
            for (let j = i + 1; j < this.coins.length; j++) {
                // Skip collision if either coin is in any falling state
                if (this.coins[i].isSpawnAreaFalling || this.coins[j].isSpawnAreaFalling || 
                    this.coins[i].isFalling || this.coins[j].isFalling) {
                    continue;
                }
                
                if (this.coins[i].isCollidingWith(this.coins[j])) {
                    this.coins[i].resolveCollision(this.coins[j], this.tolerance);
                }
            }
        }
        
        // Draw all coins
        for (const coin of this.coins) {
            coin.draw(this.ctx);
        }
        
        // Update HUD
        this.updateHUD();
        
        requestAnimationFrame(this.animate);
    }
    
    drawAreas() {
        const ctx = this.ctx;
        
        // Draw spawn area (top)
        ctx.fillStyle = 'rgba(255, 182, 193, 0.3)'; // Light pink tint for spawn area
        ctx.fillRect(0, 0, this.canvas.width, this.areas.spawnAreaHeight);
        
        // Draw spawn area border
        ctx.fillStyle = 'rgba(255, 105, 180, 0.8)'; // Hot pink for spawn area border
        ctx.fillRect(0, this.areas.spawnAreaHeight - 5, this.canvas.width, 5);
        
        // Draw table area
        ctx.fillStyle = 'rgba(139, 69, 19, 0.3)'; // Brown tint for table
        ctx.fillRect(0, this.areas.spawnAreaHeight, this.canvas.width, this.canvas.height * CONFIG.tableHeightRatio);
        
        // Draw table edge/border
        ctx.fillStyle = 'rgba(101, 67, 33, 0.8)'; // Darker brown for table edge
        ctx.fillRect(0, this.areas.tableHeight - 8, this.canvas.width, 8);
        
        // Draw falling space area (middle)
        ctx.fillStyle = 'rgba(135, 206, 235, 0.1)'; // Light blue tint for air
        ctx.fillRect(0, this.areas.tableHeight, this.canvas.width, this.areas.fallingSpaceHeight);
        
        // Draw floor area (bottom)
        ctx.fillStyle = 'rgba(105, 105, 105, 0.4)'; // Gray tint for floor
        ctx.fillRect(0, this.areas.floorTop, this.canvas.width, this.areas.floorHeight);
        
        // Draw floor surface
        ctx.fillStyle = 'rgba(70, 70, 70, 0.8)'; // Darker gray for floor surface
        ctx.fillRect(0, this.areas.floorTop, this.canvas.width, 5);
        
        // Add area labels
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        
        // Spawn area label
        ctx.fillText('SPAWN AREA', this.canvas.width / 2, this.areas.spawnAreaHeight / 2);
        ctx.fillText('(Click to spawn coins)', this.canvas.width / 2, this.areas.spawnAreaHeight / 2 + 15);
        
        // Table label
        const tableAreaMiddle = this.areas.spawnAreaHeight + (this.canvas.height * CONFIG.tableHeightRatio) / 2;
        ctx.fillText('TABLE', this.canvas.width / 2, tableAreaMiddle);
        
        // Falling space label
        ctx.fillText('FALLING SPACE', this.canvas.width / 2, this.areas.tableHeight + this.areas.fallingSpaceHeight / 2);
        
        // Floor label
        ctx.fillText('FLOOR', this.canvas.width / 2, this.areas.floorTop + this.areas.floorHeight / 2);
    }
    
    // Optional: Add console logging for debugging (can be removed if not needed)
    updateHUD() {
        // Count and update falling coins for console output (optional debugging)
        const fallingCoins = this.coins.filter(coin => coin.isFalling).length;
        const floatingCoins = this.coins.length - fallingCoins;
        
        // Uncomment the line below if you want to see stats in the console
        // console.log(`Coins: ${this.coins.length}, Falling: ${fallingCoins}, Floating: ${floatingCoins}, Friction: ${this.friction.toFixed(1)}`);
    }
}

// Initialize simulation when page loads
let simulation;

window.addEventListener('load', () => {
    const canvas = document.getElementById('gameCanvas');
    simulation = new CoinSimulation(canvas);
});
