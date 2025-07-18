// --- Setup ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const levelDisplay = document.getElementById('level-display');
const scoreDisplay = document.getElementById('score-display');
const pucksDisplay = document.getElementById('pucks-display');
const hitsDisplay = document.getElementById('hits-display');

// --- Sound Effects ---
const sounds = {
    click: new Audio('sounds/click.mp3'),
    clack: new Audio('sounds/clack.mp3'),
    swoosh: new Audio('sounds/swoosh.mp3'),
    plonk: new Audio('sounds/plonk.mp3'),
    life: new Audio('sounds/life.mp3')
};

// --- Game State Variables ---

let level = 1;
let score = 0;
let puckCount = 5;
let shotsThisLevel = 0;

let puck, hole;
let obstacles = []; // Array to hold all obstacles
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let obstacleHitCounter = 0;

function playSound(sound) {
    // Clones the audio node to allow the same sound to be played multiple times at once
    const soundInstance = sound.cloneNode();
    soundInstance.play().catch(e => console.error("Sound play failed:", e));
}

// --- Core Functions ---
/**
 * Updates the score, level, and puck count display on the screen.
 */
function updateUI() {
    scoreDisplay.textContent = score;
    pucksDisplay.textContent = puckCount;
    levelDisplay.textContent = level;
    hitsDisplay.textContent = 10 - obstacleHitCounter; // <<<--- ADD THIS LINE
}
/**
 * Creates a new obstacle of a given type.
 * @param {string} type - 'hole_static', 'hole_moving', or 'puck_moving'.
 * @returns {object} The created obstacle object.
 */
function createObstacle(type) {
    // --- THIS IS THE CHANGE ---
    // Keep obstacles 50px away from the edges
    const padding = 50; 
    
    const obstacle = {
        type: type,
        sides: 0,
        x: padding + Math.random() * (canvas.width - padding * 2),
        y: padding + Math.random() * (canvas.height - padding * 2),
        size: 0,
        vx: 0,
        vy: 0,
        color: '#ff0000'
    };

    if (type.includes('hole')) {
        obstacle.size = 25;
        obstacle.color = '#331a00';
        if (type === 'hole_moving') {
            obstacle.vx = (Math.random() - 0.5) * 2;
            obstacle.vy = (Math.random() - 0.5) * 2;
        }
    } else if (type === 'puck_moving') {
        obstacle.size = 12;
        obstacle.color = `hsl(${Math.random() * 360}, 100%, 75%)`;
        
        const speed = 1 + Math.random() * 1.5; 
        const angle = Math.random() * Math.PI * 2;
        obstacle.vx = Math.cos(angle) * speed;
        obstacle.vy = Math.sin(angle) * speed;
    }

    // Ensure it doesn't spawn too close to the main goal hole
    const dx = obstacle.x - (canvas.width / 2);
    const dy = obstacle.y - (canvas.height / 2);
    if (Math.sqrt(dx * dx + dy * dy) < 150) {
        return createObstacle(type); // Try again if too close
    }
    return obstacle;
}

/**
 * Resets the player puck to a new random, safe position.
 */
function resetPuckPosition() {
    puck.vx = 0;
    puck.vy = 0;
    do {
        puck.x = Math.random() * (canvas.width - 100) + 50;
        puck.y = Math.random() * (canvas.height - 100) + 50;
        // A simple check to avoid spawning inside the main hole
        const dx = puck.x - hole.x;
        const dy = puck.y - hole.y;
        if (Math.sqrt(dx * dx + dy * dy) < hole.size + 50) continue;
        
        let isSafe = true;
        for (const obs of obstacles) {
             const odx = puck.x - obs.x;
             const ody = puck.y - obs.y;
             if (Math.sqrt(odx*ody + ody*ody) < obs.size + 50) {
                isSafe = false;
                break;
             }
        }
        if (isSafe) break;
    } while (true);
}

/**
 * Checks if a new obstacle is colliding with any existing ones.
 * @param {object} newObs - The new obstacle to check.
 * @param {Array} existingObstacles - The array of obstacles already on the board.
 * @returns {boolean} - True if there is a collision, false otherwise.
 */
function isCollidingWithOtherObstacles(newObs, existingObstacles) {
    for (const existingObs of existingObstacles) {
        const dx = newObs.x - existingObs.x;
        const dy = newObs.y - existingObs.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if the distance is less than the sum of their sizes plus a small buffer
        const minDistance = newObs.size + existingObs.size + 15; // 15px buffer
        if (distance < minDistance) {
            return true; // Collision detected!
        }
    }
    return false; // No collision
}

/**
 * Resets the game for the current level, generating shapes dynamically.
 */
function resetLevel() {
    levelDisplay.textContent = level;
    shotsThisLevel = 0;
    obstacleHitCounter = 0;
    
    let config;
    switch(level) {
        case 1: config = { type: 'polygon', sides: 0, puckSize: 15, holeSize: 25, rotation: 0 }; break;
        case 2: config = { type: 'polygon', sides: 4, puckSize: 20, holeSize: 30, rotation: Math.PI / 4 }; break;
        case 3: config = { type: 'polygon', sides: 3, puckSize: 20, holeSize: 30, rotation: 0 }; break;
        case 4: config = { type: 'polygon', sides: 4, puckSize: 20, holeSize: 30, rotation: 0 }; break;
        default: config = { type: 'star', sides: level, puckSize: 20, holeSize: 30, rotation: 0 }; break;
    }

    hole = { x: canvas.width / 2, y: canvas.height / 2, size: config.holeSize, sides: config.sides, type: config.type, rotation: config.rotation };
    puck = { x: 0, y: 0, size: config.puckSize, sides: config.sides, type: config.type, rotation: config.rotation, vx: 0, vy: 0 };
    
    // --- Generate Obstacles ---
    obstacles = [];
    if (level > 1) {
        const bonusSets = Math.floor((level - 1) / 5);
        const obstacleCounts = {
            staticHoles: 2 + (bonusSets * 2),
            movingHoles: 1,
            movingPucks: 3 + (bonusSets * 2)
        };
        
        // --- THIS IS THE CHANGE ---
        // Helper to safely create and place one obstacle at a time
        const createAndPlaceObstacle = (type) => {
            let newObstacle;
            let isSafe;
            do {
                newObstacle = createObstacle(type);
                // Check against all previously placed obstacles
                isSafe = !isCollidingWithOtherObstacles(newObstacle, obstacles);
            } while (!isSafe); // Keep trying until a safe spot is found
            obstacles.push(newObstacle);
        };
        
        // Use the safe placement helper for each obstacle
        for (let i = 0; i < obstacleCounts.staticHoles; i++) createAndPlaceObstacle('hole_static');
        for (let i = 0; i < obstacleCounts.movingHoles; i++) createAndPlaceObstacle('hole_moving');
        for (let i = 0; i < obstacleCounts.movingPucks; i++) createAndPlaceObstacle('puck_moving');
    }
    
    resetPuckPosition();
    updateUI();
}
/**
 * Handles the logic when the player scores in the correct hole.
 */
function handleCorrectHole() {
    playSound(sounds.swoosh);
    // Calculate points based on shots this level
    let points = Math.max(0, 6000 - (shotsThisLevel * 1000));
    score += points;

    level++;
    // Award bonus puck every 5 levels
    if (level > 1 && level % 5 === 0) {
        puckCount++;
    }
    
    resetLevel();
}

/**
 * Handles the logic when the player's puck falls into a wrong hole.
 */
function handleWrongHole() {
    playSound(sounds.plonk);
    puckCount--;
    if (puckCount < 0) {
        alert(`Game Over! Your final score is: ${score}`);
        level = 1;
        score = 0;
        puckCount = 5;
        resetLevel();
    } else {
        // Just reset the puck for another try
        resetPuckPosition();
        updateUI();
    }
}

/**
 * Simulates a physical collision between two pucks and handles penalties.
 * @param {object} p1 - The first puck.
 * @param {object} p2 - The second puck.
 */
function handlePuckCollision(p1, p2) {
    if (!p1 || !p2) return; // Safety check
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < p1.size + p2.size) {
        // --- THIS IS THE NEW LOGIC ---
        // Check if this is a collision between the player's puck and an obstacle puck
        const isPlayerCollision = (p1 === puck && p2.type === 'puck_moving') || (p2 === puck && p1.type === 'puck_moving');
        
        if (isPlayerCollision) {
            playSound(sounds.clack);
            score -= 500; // Reduce score by 500
            obstacleHitCounter++;

            if (obstacleHitCounter >= 10) {
                playSound(sounds.life);
                puckCount--; // Lose a life/puck
                obstacleHitCounter = 0; // Reset counter
                if (puckCount < 0) {
                     alert(`Game Over! Your final score is: ${score}`);
                     level = 1;
                     score = 0;
                     puckCount = 5;
                     resetLevel();
                }
            }
            updateUI(); // Update score and hits display immediately
        }
        
        // --- Physics calculation (existing code) ---
        const nx = dx / distance;
        const ny = dy / distance;
        const tx = -ny;
        const ty = nx;
        
        const dpTan1 = p1.vx * tx + p1.vy * ty;
        const dpTan2 = p2.vx * tx + p2.vy * ty;
        const dpNorm1 = p1.vx * nx + p1.vy * ny;
        const dpNorm2 = p2.vx * nx + p2.vy * ny;
        
        const m1 = (dpNorm1 * (p1.size - p2.size) + 2 * p2.size * dpNorm2) / (p1.size + p2.size);
        const m2 = (dpNorm2 * (p2.size - p1.size) + 2 * p1.size * dpNorm1) / (p1.size + p2.size);
        
        p1.vx = tx * dpTan1 + nx * m1;
        p1.vy = ty * dpTan1 + ny * m1;
        p2.vx = tx * dpTan2 + nx * m2;
        p2.vy = ty * dpTan2 + ny * m2;
        
        const overlap = p1.size + p2.size - distance;
        p1.x -= overlap * nx * 0.5;
        p1.y -= overlap * ny * 0.5;
        p2.x += overlap * nx * 0.5;
        p2.y += overlap * ny * 0.5;
    }
}

// --- Drawing Functions ---

function drawBoard() {
    ctx.fillStyle = '#006400';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawShape(shape, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    if (shape.type === 'star') {
        const points = shape.sides;
        const outerRadius = shape.size;
        const innerRadius = shape.size / 2;
        const angleStep = Math.PI / points;
        for (let i = 0; i < 2 * points; i++) {
            const radius = (i % 2 === 0) ? outerRadius : innerRadius;
            const angle = (shape.rotation || 0) + i * angleStep - Math.PI / 2; 
            const x = shape.x + radius * Math.cos(angle);
            const y = shape.y + radius * Math.sin(angle);
            if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
    } else if (shape.sides === 0) { // Circle
        ctx.arc(shape.x, shape.y, shape.size, 0, Math.PI * 2);
    } else { // Polygon
        const angleStep = (Math.PI * 2) / shape.sides;
        const startAngle = shape.rotation || 0;
        for (let i = 0; i < shape.sides; i++) {
            const angle = startAngle + i * angleStep;
            const x = shape.x + shape.size * Math.cos(angle);
            const y = shape.y + shape.size * Math.sin(angle);
            if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}


// --- Main Game Loop ---
function gameLoop() {
    // --- Update Logic ---
    puck.vx *= 0.99; // Friction
    puck.vy *= 0.99;
    puck.x += puck.vx;
    puck.y += puck.vy;

    if (puck.x + puck.size > canvas.width || puck.x - puck.size < 0) puck.vx *= -1;
    if (puck.y + puck.size > canvas.height || puck.y - puck.size < 0) puck.vy *= -1;

    obstacles.forEach(obs => {
        if (obs.type === 'hole_moving' || obs.type === 'puck_moving') {
            obs.x += obs.vx;
            obs.y += obs.vy;
            if (obs.x + obs.size > canvas.width || obs.x - obs.size < 0) obs.vx *= -1;
            if (obs.y + obs.size > canvas.height || obs.y - obs.size < 0) obs.vy *= -1;
        }
    });

    // --- Collision Detection ---
    const movingPucks = obstacles.filter(o => o.type === 'puck_moving');
    movingPucks.forEach(obsPuck => {
        handlePuckCollision(puck, obsPuck);
    });
    for (let i = 0; i < movingPucks.length; i++) {
        for (let j = i + 1; j < movingPucks.length; j++) {
            handlePuckCollision(movingPucks[i], movingPucks[j]);
        }
    }
    
    const allHoles = obstacles.filter(o => o.type.includes('hole'));
    for (const obsHole of allHoles) {
        const dx = puck.x - obsHole.x;
        const dy = puck.y - obsHole.y;
        if (puck.vx !== 0 || puck.vy !== 0) {
            
            // --- THIS IS THE CHANGE ---
            // Puck is captured if its center enters the hole's radius.
            if (Math.sqrt(dx * dx + dy * dy) < obsHole.size) {
                handleWrongHole();
                break;
            }
        }
    }
    
    const dx = puck.x - hole.x;
    const dy = puck.y - hole.y;
    if (Math.sqrt(dx * dx + dy * dy) < hole.size - puck.size) {
        handleCorrectHole();
    }
    
    // --- Drawing Logic ---
    drawBoard();
    obstacles.forEach(obs => drawShape(obs, obs.color));
    drawShape(hole, '#000');
    drawShape(puck, '#fff');

    if (isDragging) {
        ctx.beginPath();
        ctx.moveTo(puck.x, puck.y);
        ctx.lineTo(dragStart.x, dragStart.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    requestAnimationFrame(gameLoop);
}
// --- Event Listeners ---
function handleShot(endX, endY) {
    if (isDragging) {
        isDragging = false;
        shotsThisLevel++;
        // The scoring system is based on tries, so we add 1 here.
        puck.vx = (puck.x - endX) / 10;
        puck.vy = (puck.y - endY) / 10;
    }
}
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function handleDragStart(x, y) {
    const dx = x - puck.x;
    const dy = y - puck.y;
    if (Math.sqrt(dx * dx + dy * dy) < puck.size) {
        playSound(sounds.click);
        isDragging = true;
        dragStart = { x: x, y: y };
    }
}
function handleDragMove(x, y) {
    if (isDragging) dragStart = { x: x, y: y };
}

// Mouse Events
canvas.addEventListener('mousedown', (e) => handleDragStart(getMousePos(e).x, getMousePos(e).y));
canvas.addEventListener('mousemove', (e) => handleDragMove(getMousePos(e).x, getMousePos(e).y));
canvas.addEventListener('mouseup', (e) => handleShot(getMousePos(e).x, getMousePos(e).y));

// Touch Events
function getTouchPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
}
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); const pos = getTouchPos(e); handleDragStart(pos.x, pos.y); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (isDragging) { const pos = getTouchPos(e); handleDragMove(pos.x, pos.y); } }, { passive: false });
canvas.addEventListener('touchend', () => handleShot(dragStart.x, dragStart.y));

// --- Start Game ---
resetLevel();
gameLoop();