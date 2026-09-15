/* ==========================================================================
   CANDY PACKS PUZZLE & SPIN GAME - LOGIC & INTERACTION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  // Screens
  const screenPuzzle = document.getElementById('screen-puzzle');
  const screenSpinner = document.getElementById('screen-spinner');
  const screenPrize = document.getElementById('screen-prize');

  // Screen 1: Puzzle Elements
  const gridContainer = document.getElementById('puzzle-grid');
  const timerVal = document.getElementById('timer-val');
  const movesVal = document.getElementById('moves-val');
  const previewBtn = document.getElementById('preview-btn');
  const resetBtn = document.getElementById('reset-btn');
  const soundBtnPuzzle = document.getElementById('sound-btn-puzzle');
  
  // Screen 2: Spinner Elements
  const wheelCanvas = document.getElementById('wheel-canvas');
  const spinActionBtn = document.getElementById('spin-action-btn');
  const soundBtnSpinner = document.getElementById('sound-btn-spinner');
  
  // Screen 3: Prize Elements
  const ticketHeader = document.querySelector('.ticket-header-text');
  const ticketSubText = document.querySelector('.ticket-sub-text');
  const ticketLocation = document.querySelector('.ticket-location');
  const ticketDonutContainer = document.querySelector('.ticket-donut-container');
  const claimCouponBtn = document.getElementById('claim-coupon-btn');
  const restartGameBtn = document.getElementById('restart-game-btn');

  // Modals & Overlays
  const winModal = document.getElementById('win-modal');
  const winMoves = document.getElementById('win-moves');
  const winTime = document.getElementById('win-time');
  const goToWheelBtn = document.getElementById('go-to-wheel-btn');
  const puzzlePlayAgainBtn = document.getElementById('puzzle-play-again-btn');
  const previewModal = document.getElementById('preview-modal');
  const closePreviewBtn = document.getElementById('close-preview-btn');
  const bgParticlesContainer = document.getElementById('bg-particles');

  // --- Sound Toggle Paths ---
  const soundIconPaths = document.querySelectorAll('.sound-icon-path');

  // --- Game State ---
  const gridSize = 3;
  const totalTiles = gridSize * gridSize;
  let tiles = []; // Image piece indices in grid
  let selectedTileIndex = null;
  let moves = 0;
  let secondsElapsed = 0;
  let timerInterval = null;
  let gameStarted = false;
  let soundEnabled = true;
  let audioCtx = null;

  // --- Wheel Spinner State ---
  const wheelCtx = wheelCanvas.getContext('2d');
  const sectors = [
    { label: "FREE COFFEE", emoji: "☕", color: "#ff007f", store: "Lee's Coffee", code: "COFFEE777" },
    { label: "FREE DONUT", emoji: "🍩", color: "#bd00ff", store: "Lee's Donuts", code: "DONUTFREE" }, // Matches the screenshot ticket!
    { label: "FREE COOKIE", emoji: "🍪", color: "#00f0ff", store: "Lee's Bakery", code: "COOKIE101" },
    { label: "FREE CAKE", emoji: "🍰", color: "#39ff14", store: "Lee's Cafe", code: "CAKESLICE" },
    { label: "ORANGE JUICE", emoji: "🍊", color: "#ffd800", store: "Lee's Juice Bar", code: "ORANGE505" },
    { label: "MYSTERY BOX", emoji: "🎁", color: "#ff5e00", store: "Candy Packs Shop", code: "MYSTERY99" },
    { label: "STRAWBERRY", emoji: "🍓", color: "#ff00ff", store: "Candy Fruit Bar", code: "BERRYGOOD" },
    { label: "ICE CREAM", emoji: "🍦", color: "#00ffcc", store: "Lee's Ice Cream", code: "ICECREAM1" },
    { label: "CANDY PACK", emoji: "🍬", color: "#7b00ff", store: "Candy Packs", code: "SWEETCANDY" }
  ];
  const totalSectors = sectors.length;
  const arcSize = (2 * Math.PI) / totalSectors;
  
  let wheelAngle = 0;
  let isSpinning = false;
  let lastTickedSegment = -1;
  let marqueeTick = 0;
  let selectedPrizeIndex = 1; // Default to Donut (index 1) for higher rate or forced demo landing!

  // --- Initialize Audio Context ---
  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // --- Sound Synthesizers using Web Audio API ---
  function playSound(type) {
    if (!soundEnabled) return;
    initAudio();
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'select') {
      // Short pop/click
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } 
    else if (type === 'swap') {
      // Quick swipe/whoosh
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.25);
      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } 
    else if (type === 'tick') {
      // High pitch woodblock tick for the wheel pointer
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
      gainNode.gain.setValueAtTime(0.06, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } 
    else if (type === 'win') {
      // Arpeggio victory chord
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25]; // C4, E4, G4, C5, E5
      notes.forEach((freq, index) => {
        const chordOsc = audioCtx.createOscillator();
        const chordGain = audioCtx.createGain();
        chordOsc.connect(chordGain);
        chordGain.connect(audioCtx.destination);
        
        chordOsc.type = 'sine';
        chordOsc.frequency.setValueAtTime(freq, now + index * 0.08);
        chordGain.gain.setValueAtTime(0.12, now + index * 0.08);
        chordGain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.6);
        
        chordOsc.start(now + index * 0.08);
        chordOsc.stop(now + index * 0.08 + 0.6);
      });
    }
  }

  // --- Screen Routing Controller ---
  function showScreen(screenId) {
    // Hide all
    screenPuzzle.classList.remove('active');
    screenPuzzle.classList.add('hidden');
    screenSpinner.classList.remove('active');
    screenSpinner.classList.add('hidden');
    screenPrize.classList.remove('active');
    screenPrize.classList.add('hidden');

    // Show selected
    const activeScreen = document.getElementById(screenId);
    activeScreen.classList.remove('hidden');
    activeScreen.classList.add('active');

    // Canvas Draw trigger
    if (screenId === 'screen-spinner') {
      drawWheel();
      // Start marquee bulbs animation
      animateMarquee();
    }
  }

  // --- Background Particle System ---
  function createParticles() {
    const particleCount = 15;
    for (let i = 0; i < particleCount; i++) {
      spawnParticle();
    }
    setInterval(spawnParticle, 1500);
  }

  function spawnParticle() {
    if (document.hidden) return;
    const particle = document.createElement('div');
    particle.classList.add('particle');
    
    const size = Math.random() * 8 + 4;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}%`;
    
    const duration = Math.random() * 5 + 5;
    particle.style.animationDuration = `${duration}s`;
    
    const delay = Math.random() * 5;
    particle.style.animationDelay = `-${delay}s`;
    
    const drift = (Math.random() - 0.5) * 60;
    particle.style.setProperty('--drift', `${drift}px`);
    
    const colors = ['rgba(255, 0, 127, 0.35)', 'rgba(189, 0, 255, 0.35)', 'rgba(0, 240, 255, 0.35)', 'rgba(255, 255, 255, 0.35)'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.background = `radial-gradient(circle, #ffffff 0%, ${randomColor} 100%)`;
    
    bgParticlesContainer.appendChild(particle);
    
    setTimeout(() => {
      particle.remove();
    }, duration * 1000);
  }

  // ==========================================================================
  // SCREEN 1: PUZZLE GAME LOGIC
  // ==========================================================================
  
  function initGame() {
    tiles = Array.from({ length: totalTiles }, (_, i) => i);
    shuffleTiles();
    moves = 0;
    secondsElapsed = 0;
    selectedTileIndex = null;
    gameStarted = false;
    
    updateStatsDisplay();
    clearInterval(timerInterval);
    timerInterval = null;
    
    renderGrid();
  }

  function renderGrid() {
    gridContainer.innerHTML = '';
    
    for (let i = 0; i < totalTiles; i++) {
      const tileValue = tiles[i];
      const tileDiv = document.createElement('div');
      tileDiv.classList.add('puzzle-tile');
      tileDiv.setAttribute('data-grid-idx', i);
      tileDiv.setAttribute('role', 'button');
      tileDiv.setAttribute('aria-label', `Puzzle piece at position ${i + 1}`);

      const sourceCol = tileValue % gridSize;
      const sourceRow = Math.floor(tileValue / gridSize);
      
      const bgX = (sourceCol / (gridSize - 1)) * 100;
      const bgY = (sourceRow / (gridSize - 1)) * 100;
      
      tileDiv.style.backgroundImage = "url('puzzle_source.jpg')";
      tileDiv.style.backgroundSize = "300% 300%";
      tileDiv.style.backgroundPosition = `${bgX}% ${bgY}%`;
      
      if (i === selectedTileIndex) {
        tileDiv.classList.add('selected');
      }
      
      tileDiv.addEventListener('click', () => handleTileClick(i));
      gridContainer.appendChild(tileDiv);
    }
  }

  function shuffleTiles() {
    for (let i = 0; i < 30; i++) {
      const idxA = Math.floor(Math.random() * totalTiles);
      const idxB = Math.floor(Math.random() * totalTiles);
      if (idxA !== idxB) {
        const temp = tiles[idxA];
        tiles[idxA] = tiles[idxB];
        tiles[idxB] = temp;
      }
    }
    if (checkSolved()) {
      shuffleTiles();
    }
  }

  function handleTileClick(clickedIdx) {
    if (!gameStarted) {
      startTimer();
      gameStarted = true;
    }
    
    if (selectedTileIndex === null) {
      selectedTileIndex = clickedIdx;
      playSound('select');
      renderGrid();
    } 
    else if (selectedTileIndex === clickedIdx) {
      selectedTileIndex = null;
      playSound('select');
      renderGrid();
    } 
    else {
      const prevSelectedIdx = selectedTileIndex;
      selectedTileIndex = null;
      
      const tempVal = tiles[prevSelectedIdx];
      tiles[prevSelectedIdx] = tiles[clickedIdx];
      tiles[clickedIdx] = tempVal;
      
      moves++;
      updateStatsDisplay();
      playSound('swap');
      
      const tileA = gridContainer.querySelector(`[data-grid-idx="${prevSelectedIdx}"]`);
      const tileB = gridContainer.querySelector(`[data-grid-idx="${clickedIdx}"]`);
      tileA.classList.add('swapping');
      tileB.classList.add('swapping');

      setTimeout(() => {
        renderGrid();
        if (checkSolved()) {
          handleWin();
        }
      }, 200);
    }
  }

  function checkSolved() {
    for (let i = 0; i < totalTiles; i++) {
      if (tiles[i] !== i) return false;
    }
    return true;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      secondsElapsed++;
      timerVal.textContent = formatTime(secondsElapsed);
    }, 1000);
  }

  function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function updateStatsDisplay() {
    movesVal.textContent = moves;
    timerVal.textContent = formatTime(secondsElapsed);
  }

  function handleWin() {
    clearInterval(timerInterval);
    playSound('win');
    
    winMoves.textContent = moves;
    winTime.textContent = formatTime(secondsElapsed);
    
    setTimeout(() => {
      winModal.classList.remove('hidden');
      triggerConfetti();
    }, 300);
  }

  function triggerConfetti() {
    const colors = ['#ff007f', '#bd00ff', '#39ff14', '#00f0ff', '#ffef3d'];
    const container = document.body;
    
    for (let i = 0; i < 80; i++) {
      const confetti = document.createElement('div');
      confetti.classList.add('confetti');
      const size = Math.random() * 6 + 6;
      confetti.style.width = `${size}px`;
      confetti.style.height = `${size}px`;
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.left = `${Math.random() * 100}vw`;
      const drift = (Math.random() - 0.5) * 200;
      confetti.style.setProperty('--drift', `${drift}px`);
      const duration = Math.random() * 2 + 1.5;
      confetti.style.animationDuration = `${duration}s`;
      
      container.appendChild(confetti);
      setTimeout(() => {
        confetti.remove();
      }, duration * 1000);
    }
  }

  // ==========================================================================
  // SCREEN 2: SPIN WHEEL LOGIC
  // ==========================================================================
  
  // Renders vector sectors onto Canvas
  function drawWheel() {
    const w = wheelCanvas.width;
    const h = wheelCanvas.height;
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = w / 2 - 10;
    
    wheelCtx.clearRect(0, 0, w, h);
    
    // 1. Draw sectors
    for (let i = 0; i < totalSectors; i++) {
      const sector = sectors[i];
      const startAngle = i * arcSize + wheelAngle;
      const endAngle = (i + 1) * arcSize + wheelAngle;
      
      wheelCtx.beginPath();
      wheelCtx.moveTo(centerX, centerY);
      wheelCtx.arc(centerX, centerY, radius, startAngle, endAngle);
      wheelCtx.closePath();
      
      // Sector background color
      wheelCtx.fillStyle = sector.color;
      wheelCtx.fill();
      
      // Border outline of the sector
      wheelCtx.strokeStyle = "rgba(0,0,0,0.15)";
      wheelCtx.lineWidth = 2;
      wheelCtx.stroke();
      
      // 2. Draw Text Labels & Emojis along sector center line
      wheelCtx.save();
      wheelCtx.translate(centerX, centerY);
      wheelCtx.rotate(startAngle + arcSize / 2);
      
      // Draw label text
      wheelCtx.textAlign = "right";
      wheelCtx.fillStyle = "#ffffff";
      // Outline text for better readability
      wheelCtx.strokeStyle = "#000000";
      wheelCtx.lineWidth = 3;
      wheelCtx.lineJoin = "round";
      
      wheelCtx.font = "bold 13px Outfit";
      const txtX = radius - 55;
      const txtY = 5;
      wheelCtx.strokeText(sector.label, txtX, txtY);
      wheelCtx.fillText(sector.label, txtX, txtY);
      
      // Draw 3D-styled Emojis
      wheelCtx.font = "26px Arial";
      const emoX = radius - 20;
      const emoY = 10;
      wheelCtx.fillText(sector.emoji, emoX, emoY);
      
      wheelCtx.restore();
    }
    
    // 3. Draw Outer Marquee bulbs onto canvas rim
    const bulbCount = 18;
    const bulbRadius = 5;
    for (let i = 0; i < bulbCount; i++) {
      const bulbAngle = (i * (2 * Math.PI)) / bulbCount;
      const bulbX = centerX + (radius - 4) * Math.cos(bulbAngle);
      const bulbY = centerY + (radius - 4) * Math.sin(bulbAngle);
      
      wheelCtx.beginPath();
      wheelCtx.arc(bulbX, bulbY, bulbRadius, 0, 2 * Math.PI);
      wheelCtx.closePath();
      
      // Flashing bulb color logic
      const isLit = (i + marqueeTick) % 2 === 0;
      wheelCtx.fillStyle = isLit ? "#ffef3d" : "#998300";
      wheelCtx.shadowBlur = isLit ? 10 : 0;
      wheelCtx.shadowColor = "#ffef3d";
      
      wheelCtx.fill();
      
      // Bulb stroke
      wheelCtx.shadowBlur = 0; // Reset shadow
      wheelCtx.strokeStyle = "#333";
      wheelCtx.lineWidth = 1;
      wheelCtx.stroke();
    }
    
    // 4. Center hub cap overlay
    wheelCtx.beginPath();
    wheelCtx.arc(centerX, centerY, 42, 0, 2 * Math.PI);
    wheelCtx.closePath();
    wheelCtx.fillStyle = "#ffffff";
    wheelCtx.shadowBlur = 15;
    wheelCtx.shadowColor = "rgba(0,0,0,0.5)";
    wheelCtx.fill();
    wheelCtx.shadowBlur = 0; // Reset shadow
  }

  // Animates marquee bulbs while the spinner is displayed
  function animateMarquee() {
    if (screenSpinner.classList.contains('hidden')) return;
    
    // Increment flash tick based on spin state
    const interval = isSpinning ? 100 : 400; // Flash faster when spinning
    setTimeout(() => {
      marqueeTick++;
      drawWheel();
      animateMarquee();
    }, interval);
  }

  // Spin physical deceleration trigger
  function triggerSpin() {
    if (isSpinning) return;
    
    initAudio();
    isSpinning = true;
    spinActionBtn.disabled = true;
    playSound('select');
    
    // Pick a random landing sector (we have Lee's Donuts as the hero prize, let's land on Donut [index 1])
    // To keep it organic but ensure the donut ticket displays, we'll force the landing to index 1 (FREE DONUT)
    selectedPrizeIndex = 1; 
    
    const startTime = performance.now();
    const duration = 5500; // 5.5 seconds spin time
    
    const startAngle = wheelAngle;
    const pointerAngle = -Math.PI / 2; // Pointer is at 12 o'clock
    
    // targetAngle offset calculation so that selectedPrizeIndex lands at pointer
    const targetSegmentOffset = (selectedPrizeIndex + 0.5) * arcSize;
    const finalAngleOffset = pointerAngle - targetSegmentOffset;
    
    // Calculate total rotation (8 full spins + alignment offset)
    const totalSpins = 8 * 2 * Math.PI;
    const endAngle = startAngle + totalSpins + finalAngleOffset - (startAngle % (2 * Math.PI));
    
    lastTickedSegment = -1;

    // Easing equations: Quintic ease out
    function easeOutQuint(t) {
      return 1 - Math.pow(1 - t, 5);
    }

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Update wheel rotation angle
      const easedProgress = easeOutQuint(progress);
      wheelAngle = startAngle + (endAngle - startAngle) * easedProgress;
      
      // Pointer clicking sound effect triggers when passing each slice
      // Calculate current slice under pointer
      const pointerRadian = -Math.PI / 2;
      const relativeRadian = (pointerRadian - wheelAngle) % (2 * Math.PI);
      const normalizedRadian = relativeRadian < 0 ? relativeRadian + 2 * Math.PI : relativeRadian;
      const currentSegment = Math.floor(normalizedRadian / arcSize);
      
      if (currentSegment !== lastTickedSegment && progress < 0.96) {
        playSound('tick');
        lastTickedSegment = currentSegment;
      }
      
      drawWheel();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Spin finished
        setTimeout(handleSpinComplete, 800);
      }
    }
    
    requestAnimationFrame(animate);
  }

  function handleSpinComplete() {
    isSpinning = false;
    spinActionBtn.disabled = false;
    playSound('win');
    
    // Transition to Screen 3: Prize Ticket
    setupPrizeTicket(sectors[selectedPrizeIndex]);
    showScreen('screen-prize');
    triggerConfetti();
  }

  // ==========================================================================
  // SCREEN 3: PRIZE TICKET LOGIC
  // ==========================================================================
  
  function setupPrizeTicket(prizeData) {
    ticketHeader.textContent = prizeData.label;
    ticketLocation.innerHTML = `at <span class="highlight-pink">${prizeData.store}</span>`;
    
    // Load donut.jpg if it's the donut prize, otherwise fallback to styled emoji
    if (prizeData.label === "FREE DONUT") {
      ticketDonutContainer.innerHTML = `<img src="donut.jpg" alt="Free Donut Prize" class="ticket-donut-img">`;
    } else {
      // Fallback for other sectors
      ticketDonutContainer.innerHTML = `
        <div style="width:100%; height:100%; display:flex; justify-content:center; align-items:center; background:#ffefed; font-size:4rem; border-radius:50%;">
          ${prizeData.emoji}
        </div>`;
    }

    // Set custom click alert coupon code
    claimCouponBtn.onclick = () => {
      playSound('win');
      alert(`🎉 Coupon Claimed!\nUse code: ${prizeData.code} at the counter of ${prizeData.store} to claim your prize!`);
    };
  }

  // --- Global Sound Setup Helper ---
  function setSoundEnabled(enabled) {
    soundEnabled = enabled;
    soundIconPaths.forEach(path => {
      if (soundEnabled) {
        path.setAttribute('d', "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z");
      } else {
        path.setAttribute('d', "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z");
      }
    });
    if (soundEnabled) {
      initAudio();
      playSound('select');
    }
  }

  // --- UI Event Listeners ---
  
  // Sound Buttons
  soundBtnPuzzle.addEventListener('click', () => setSoundEnabled(!soundEnabled));
  soundBtnSpinner.addEventListener('click', () => setSoundEnabled(!soundEnabled));

  // Puzzle Actions
  resetBtn.addEventListener('click', () => {
    playSound('select');
    initGame();
  });

  previewBtn.addEventListener('click', () => {
    playSound('select');
    previewModal.classList.remove('hidden');
  });

  closePreviewBtn.addEventListener('click', () => {
    playSound('select');
    previewModal.classList.add('hidden');
  });

  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      playSound('select');
      previewModal.classList.add('hidden');
    }
  });

  // Modal solved overlays
  goToWheelBtn.addEventListener('click', () => {
    playSound('select');
    winModal.classList.add('hidden');
    showScreen('screen-spinner');
  });

  puzzlePlayAgainBtn.addEventListener('click', () => {
    playSound('select');
    winModal.classList.add('hidden');
    initGame();
  });

  // Wheel Spin button click
  spinActionBtn.addEventListener('click', triggerSpin);

  // Play Again restart button on prize screen
  restartGameBtn.addEventListener('click', () => {
    playSound('select');
    showScreen('screen-puzzle');
    initGame();
  });

  // --- Boot Strapping ---
  createParticles();
  initGame();
});
