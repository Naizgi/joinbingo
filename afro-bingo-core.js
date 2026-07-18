// ==================== game-core.js ====================
// This file holds all the original game logic, state, and connection code.
// It is shared across all pages.

const API_BASE_URL = `${window.location.protocol}//${window.location.host}/api`;
const WS_BASE_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const CARD_PRICE = 10.0;
const SOUNDS_BASE_URL = `${window.location.protocol}//${window.location.host}/sounds`;

// ==================== GAME STATE ====================
const gameState = {
    userId: null, gameId: null, gamePhase: "card_purchase", gameStatus: "card_purchase",
    gameType: "round_based", selectedCardId: null, selectedCardIndex: null,
    selectedCardNumbers: [], calledNumbers: [], markedNumbers: new Set(),
    countdown: 30, countdownTotal: 30, prizePool: 0, realPlayers: 0, fakePlayers: 0,
    totalPlayers: 0, playerCount: 0, websocket: null, isConnected: false, hasCard: false,
    gameActive: false, currentRound: 1, countdownInterval: null, bingoClaimInProgress: false,
    winnerAnnounced: false, purchasePhaseActive: true, cardPurchaseComplete: false,
    isCountdownComplete: false, cardsSold: new Set(), cardOwnership: {}, lastUpdateTime: 0,
    hasClaimedBingo: false, lastBingoCheck: 0, numberCallInterval: null, localCountdownActive: false,
    syncInterval: null, lastSyncTime: 0, phaseChangeRequested: false, serverControlledCountdown: true,
    connectionRetryCount: 0, maxConnectionRetries: 50, reconnectAttempts: 0, maxReconnectAttempts: 100,
    audioEnabled: true, audioCache: {}, audioPreloaded: false, currentAudio: null, audioQueue: [],
    isPlayingAudio: false, audioLoadProgress: 0, totalAudioFiles: 75, audioInitialized: false,
    audioInitializationAttempted: false, lastInsufficientPlayersNotification: 0, winnerData: null,
    uiSelectedCardIndex: null, winnerDisplayCountdown: 0, winnerDisplayInterval: null,
    isWinnerDisplayActive: false, isCardOperationInProgress: false, cardOperationQueue: [],
    gameComplete: false, isReconnecting: false, lastFullSyncTime: 0, fullSyncInProgress: false,
    pendingMessages: [], maxWinners: 2, winnersCount: 0, winners: [], isLoadingCards: false,
    cardsCache: { soldCards: new Set(), ownedCardIndex: null, lastUpdate: 0, cardElements: {} },
    lastCountdownSync: 0, countdownSyncThreshold: 5, cardsLoaded: false, cardsLoadAttempted: false,
    countdownStartTime: null, gameStartConfirmed: false, lastConfirmedPhase: "card_purchase",
    phaseChangePending: false, winnerSoundPlayed: false, walletBalance: 0
};

// ==================== SHARED FUNCTIONS ====================
function showNotification(message, type = "info", duration = 3000) {
    console.log(`Notification: ${message} (${type})`);
    const toast = document.getElementById("notification-toast");
    const messageEl = document.getElementById("notification-message");
    const icon = toast?.querySelector("i");
    if (toast && messageEl) {
        messageEl.textContent = message;
        if (type === "success") { toast.style.background = "var(--success)"; if (icon) icon.className = "fas fa-check-circle"; }
        else if (type === "error") { toast.style.background = "var(--accent)"; if (icon) icon.className = "fas fa-exclamation-circle"; }
        else if (type === "warning") { toast.style.background = "linear-gradient(135deg, #ff9800 0%, #f57c00 100%)"; if (icon) icon.className = "fas fa-exclamation-triangle"; }
        else { toast.style.background = "var(--primary)"; if (icon) icon.className = "fas fa-info-circle"; }
        toast.style.display = "flex";
        if (duration > 0) setTimeout(() => { toast.style.display = "none"; }, duration);
    }
}
window.showNotification = showNotification;

function validateGamePhase(expectedPhase, action) {
    if (gameState.gamePhase !== expectedPhase && gameState.gameStatus !== expectedPhase) {
        console.warn(`Phase mismatch: Expected ${expectedPhase}, got ${gameState.gamePhase}/${gameState.gameStatus} for action: ${action}`);
        const errorMsg = document.getElementById("phase-error-message");
        const errorText = document.getElementById("phase-error-text");
        if (errorMsg && errorText) {
            if (expectedPhase === "card_purchase") errorText.textContent = "Card purchase is only available during purchase phase.";
            else if (expectedPhase === "active") errorText.textContent = "Game is not in active phase.";
            errorMsg.style.display = "block";
            setTimeout(() => { errorMsg.style.display = "none"; }, 5000);
        }
        return false;
    }
    return true;
}

// STOP ALL AUDIO
function stopAllAudio() {
    if (gameState.currentAudio) {
        try { gameState.currentAudio.pause(); gameState.currentAudio.currentTime = 0; } catch (error) {}
        gameState.currentAudio = null;
    }
    gameState.audioQueue = []; gameState.isPlayingAudio = false;
    Object.values(gameState.audioCache).forEach((audio) => { if (audio) { try { audio.pause(); audio.currentTime = 0; } catch (error) {} } });
    document.querySelectorAll("audio").forEach((audio) => { try { audio.pause(); audio.currentTime = 0; } catch (error) {} });
}

function initializeAudio() {
    const audioPrompt = document.getElementById("audio-prompt");
    if (audioPrompt) audioPrompt.style.display = "none";
    gameState.audioInitialized = true; gameState.audioEnabled = true;
    updateAudioToggle(); showNotification("Sound enabled!", "success", 2000); preloadAudioFiles();
}
window.initializeAudio = initializeAudio;

function showAudioPrompt() {
    if (!gameState.audioInitialized && !gameState.audioInitializationAttempted) {
        const audioPrompt = document.getElementById("audio-prompt");
        if (audioPrompt) audioPrompt.style.display = "flex";
        gameState.audioInitializationAttempted = true;
    }
}

async function preloadAudioFiles() {
    console.log("Preloading MP3 audio files...");
    if (!gameState.audioInitialized) return false;
    const loadingElement = document.getElementById("audio-loading");
    const progressElement = document.getElementById("audio-loading-progress");
    const progressBar = document.getElementById("audio-loading-bar");
    if (loadingElement) loadingElement.style.display = "block";
    try {
        let loadedCount = 0; const loadPromises = [];
        for (let i = 1; i <= gameState.totalAudioFiles; i++) {
            const audio = new Audio(); audio.preload = "auto"; audio.volume = gameState.audioEnabled ? 1.0 : 0;
            const loadPromise = new Promise((resolve, reject) => {
                audio.oncanplaythrough = () => {
                    loadedCount++; gameState.audioLoadProgress = Math.floor((loadedCount / gameState.totalAudioFiles) * 100);
                    if (progressElement) progressElement.textContent = `${loadedCount}/${gameState.totalAudioFiles} loaded`;
                    if (progressBar) progressBar.style.width = `${gameState.audioLoadProgress}%`;
                    gameState.audioCache[i] = audio; resolve();
                };
                audio.onerror = (error) => {
                    console.warn(`Failed to load audio for number ${i}:`, error);
                    loadedCount++; gameState.audioLoadProgress = Math.floor((loadedCount / gameState.totalAudioFiles) * 100);
                    gameState.audioCache[i] = null;
                    if (progressElement) progressElement.textContent = `${loadedCount}/${gameState.totalAudioFiles} loaded`;
                    if (progressBar) progressBar.style.width = `${gameState.audioLoadProgress}%`;
                    resolve();
                };
            });
            audio.src = `${SOUNDS_BASE_URL}/${i}.m4a`; audio.load();
            loadPromises.push(loadPromise);
            if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await Promise.all(loadPromises);
        console.log("All MP3 audio files preloaded"); gameState.audioPreloaded = true;
        setTimeout(() => {
            if (loadingElement) loadingElement.style.display = "none";
            const audioStatus = document.getElementById("audio-status");
            if (audioStatus) {
                if (loadedCount === gameState.totalAudioFiles) audioStatus.innerHTML = `<i class="fas fa-check-circle"></i> Audio ready (${gameState.totalAudioFiles} numbers)`;
                else audioStatus.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Audio partially loaded (${loadedCount}/${gameState.totalAudioFiles})`;
            }
            testAudioPlayback();
        }, 500);
        return true;
    } catch (error) {
        console.error("Error preloading audio:", error); gameState.audioEnabled = false; updateAudioToggle();
        if (loadingElement) loadingElement.style.display = "none";
        const audioStatus = document.getElementById("audio-status");
        if (audioStatus) audioStatus.innerHTML = `<i class="fas fa-times-circle"></i> Audio disabled`;
        return false;
    }
}

function testAudioPlayback() {
    if (!gameState.audioEnabled || !gameState.audioPreloaded || !gameState.audioInitialized) return;
    try {
        const testAudio = new Audio(); testAudio.volume = 0.001;
        testAudio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
        testAudio.play().then(() => { console.log("Audio autoplay test successful"); testAudio.pause(); }).catch((error) => { console.warn("Audio autoplay test failed:", error); });
    } catch (error) { console.warn("Audio test error:", error); }
}

function playNumberAudio(number) {
    if (!gameState.audioEnabled || !gameState.audioPreloaded || !gameState.audioInitialized) return;
    if (gameState.winnerAnnounced || gameState.isWinnerDisplayActive) return;
    const audio = gameState.audioCache[number]; if (!audio) return;
    if (gameState.currentAudio) { try { gameState.currentAudio.pause(); gameState.currentAudio.currentTime = 0; } catch (error) {} }
    try {
        audio.currentTime = 0; audio.volume = gameState.audioEnabled ? 1.0 : 0;
        const playPromise = audio.play();
        if (playPromise !== undefined) playPromise.catch((error) => console.warn("Audio play failed:", error));
        gameState.currentAudio = audio;
    } catch (error) { console.error("Error playing audio:", error); }
}

function playWinnerSound() {
    if (gameState.winnerSoundPlayed) return;
    if (!gameState.audioEnabled || !gameState.audioInitialized) return;
    gameState.winnerSoundPlayed = true; stopAllAudio();
    try {
        const winnerAudio = new Audio(); winnerAudio.volume = gameState.audioEnabled ? 0.7 : 0;
        winnerAudio.src = `${SOUNDS_BASE_URL}/winner.mp3`;
        winnerAudio.play().then(() => console.log("Winner sound playing")).catch((error) => console.log("Winner sound play failed:", error.message));
    } catch (error) { console.warn("Error playing winner sound:", error); }
}

function toggleAudio() {
    if (!gameState.audioInitialized) { initializeAudio(); return; }
    gameState.audioEnabled = !gameState.audioEnabled;
    Object.values(gameState.audioCache).forEach((audio) => { if (audio) audio.volume = gameState.audioEnabled ? 1.0 : 0; });
    updateAudioToggle();
    if (gameState.audioEnabled && gameState.calledNumbers.length > 0) {
        const lastNumber = gameState.calledNumbers[gameState.calledNumbers.length - 1];
        setTimeout(() => playNumberAudio(lastNumber), 300);
    }
}
window.toggleAudio = toggleAudio;

function updateAudioToggle() {
    const toggle = document.getElementById("audio-toggle");
    const icon = toggle?.querySelector("i");
    if (toggle && icon) {
        if (gameState.audioEnabled && gameState.audioInitialized) { toggle.classList.remove("muted"); icon.className = "fas fa-volume-up"; toggle.title = "Mute sound"; }
        else { toggle.classList.add("muted"); icon.className = "fas fa-volume-mute"; toggle.title = "Enable sound"; }
    }
}

function getBingoLetter(number) {
    if (number === 0) return "";
    if (number <= 15) return "B"; if (number <= 30) return "I"; if (number <= 45) return "N";
    if (number <= 60) return "G"; return "O";
}

function updateFakeCardsImmediately(fakeCardIndices) {
    if (!fakeCardIndices || fakeCardIndices.length === 0) return;
    fakeCardIndices.forEach((cardIndex) => { instantCardUpdate(cardIndex, "sold"); });
    updateGameStats();
}

function updateConnectionStatus(text, color) {
    const statusDiv = document.getElementById("connection-status");
    const indicator = document.getElementById("status-indicator");
    const textSpan = document.getElementById("status-text");
    if (statusDiv && indicator && textSpan) {
        statusDiv.style.display = "block"; indicator.style.backgroundColor = color; textSpan.textContent = text;
        if (color === "green") setTimeout(() => { statusDiv.style.display = "none"; }, 3000);
    }
}

async function claimBingo() {
    if (!gameState.gameId || !gameState.hasCard) return showNotification("No active game or card", "error");
    if (!checkForBingo()) return showNotification("You do not have a winning pattern yet", "error");
    if (!validateGamePhase("active", "claimBingo")) return showNotification("Can only claim bingo during active game", "error");
    if (gameState.bingoClaimInProgress) return showNotification("Already claiming BINGO...", "info");
    const btn = document.getElementById("claim-bingo-btn");
    if (btn) { btn.innerHTML = `<div class="loading-spinner"></div> Claiming BINGO...`; btn.disabled = true; btn.className = "bingo-btn bingo-btn-verifying"; }
    gameState.bingoClaimInProgress = true; gameState.phaseChangeRequested = true;
    const success = sendWebSocketMessage({
        type: "player_bingo_claim", game_id: gameState.gameId, user_id: gameState.userId,
        timestamp: Date.now(), called_numbers: gameState.calledNumbers,
        card_numbers: gameState.selectedCardNumbers, marked_numbers: Array.from(gameState.markedNumbers),
    });
    if (!success) {
        try {
            const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/claim-bingo`, {
                method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    user_id: gameState.userId, game_type: gameState.gameType,
                    called_numbers: gameState.calledNumbers, card_numbers: gameState.selectedCardNumbers,
                    marked_numbers: Array.from(gameState.markedNumbers),
                }),
            });
            const data = await response.json();
            if (data.success) { gameState.winnerAnnounced = true; gameState.hasClaimedBingo = true; setTimeout(() => getUserBalance(), 1000); }
            else { showNotification(data.message || "Failed to claim BINGO", "error"); gameState.bingoClaimInProgress = false; gameState.phaseChangeRequested = false; updateBingoButton(); }
        } catch (apiError) { console.error("Bingo claim API error:", apiError); showNotification("Failed to connect. Please try again.", "error"); gameState.bingoClaimInProgress = false; gameState.phaseChangeRequested = false; updateBingoButton(); }
    }
}
window.claimBingo = claimBingo;

function checkForBingo() {
    try {
        if (!gameState.hasCard || !Array.isArray(gameState.selectedCardNumbers) || gameState.selectedCardNumbers.length !== 25) return false;
        const grid = []; for (let i = 0; i < 25; i += 5) grid.push(gameState.selectedCardNumbers.slice(i, i + 5));
        const markedSet = gameState.markedNumbers;
        for (let row = 0; row < 5; row++) { let complete = true; for (let col = 0; col < 5; col++) { if (row === 2 && col === 2) continue; if (!markedSet.has(grid[row][col])) { complete = false; break; } } if (complete) return true; }
        for (let col = 0; col < 5; col++) { let complete = true; for (let row = 0; row < 5; row++) { if (row === 2 && col === 2) continue; if (!markedSet.has(grid[row][col])) { complete = false; break; } } if (complete) return true; }
        let diag1Complete = true; for (let i = 0; i < 5; i++) { if (i === 2) continue; const num = grid[i][i]; if (!num || num === 0 || !markedSet.has(num)) { diag1Complete = false; break; } } if (diag1Complete) return true;
        let diag2Complete = true; for (let i = 0; i < 5; i++) { if (i === 2) continue; const num = grid[i][4 - i]; if (!num || num === 0 || !markedSet.has(num)) { diag2Complete = false; break; } } if (diag2Complete) return true;
        if (markedSet.has(grid[0][0]) && markedSet.has(grid[0][4]) && markedSet.has(grid[4][0]) && markedSet.has(grid[4][4])) return true;
        return false;
    } catch (error) { console.error("Error checking bingo:", error); return false; }
}

function updateBingoButton() {
    const btn = document.getElementById("claim-bingo-btn"); if (!btn) return;
    if (gameState.gameComplete || gameState.winnerAnnounced) { btn.innerHTML = `<i class="fas fa-trophy"></i> Game Complete`; btn.className = "bingo-btn bingo-btn-claimed"; btn.disabled = true; return; }
    if (gameState.gamePhase !== "active" && gameState.gameStatus !== "active") { btn.innerHTML = `<i class="fas fa-shopping-cart"></i> Buy Card to Play`; btn.className = "bingo-btn bingo-btn-inactive"; btn.disabled = true; return; }
    if (!gameState.hasCard) { btn.innerHTML = `<i class="fas fa-shopping-cart"></i> Buy Card to Play`; btn.className = "bingo-btn bingo-btn-inactive"; btn.disabled = true; return; }
    const hasBingo = checkForBingo(); btn.disabled = !hasBingo || gameState.bingoClaimInProgress || gameState.hasClaimedBingo;
    if (hasBingo && !gameState.bingoClaimInProgress && !gameState.hasClaimedBingo) {
        const prizeFromDB = gameState.prizePool || 0;
        btn.innerHTML = `<i class="fas fa-trophy"></i> BINGO! WIN ${prizeFromDB.toFixed(2)} birr!`;
        btn.className = "bingo-btn bingo-btn-gold"; btn.onclick = claimBingo;
    } else if (gameState.bingoClaimInProgress) {
        btn.innerHTML = `<div class="loading-spinner"></div> Verifying BINGO...`;
        btn.className = "bingo-btn bingo-btn-verifying"; btn.onclick = null;
    } else {
        btn.innerHTML = `<i class="fas fa-bell"></i> BINGO`; btn.className = "bingo-btn"; btn.onclick = null; btn.disabled = true;
    }
}

function handleServerNumberCalled(number, allCalled) {
    gameState.calledNumbers = allCalled;
    updateCalledNumbersDisplay(); updateCurrentCalledDisplay(number); updateBingoGrid();
    if (gameState.audioEnabled && gameState.audioPreloaded && gameState.audioInitialized && !gameState.winnerAnnounced && !gameState.isWinnerDisplayActive) playNumberAudio(number);
    if (checkForBingo() && !gameState.hasClaimedBingo) updateBingoButton();
}

function updateCurrentCalledDisplay(number) {
    const display = document.getElementById("current-called-letter-number");
    if (display) {
        if (number) { const letter = getBingoLetter(number); display.textContent = letter ? `${letter}-${number}` : number; }
        else if (gameState.calledNumbers.length > 0) {
            const lastNumber = gameState.calledNumbers[gameState.calledNumbers.length - 1]; const letter = getBingoLetter(lastNumber);
            display.textContent = letter ? `${letter}-${lastNumber}` : lastNumber;
        } else display.textContent = "--";
    }
}

function handlePlayerCardClick(cell, number) {
    if (!gameState.gameActive || !gameState.hasCard) return showNotification("Game not active", "error");
    if (number === 0 || number === "0") return;
    if (!gameState.calledNumbers.includes(number)) return showNotification("This number has not been called yet!", "error");
    if (gameState.markedNumbers.has(number)) { gameState.markedNumbers.delete(number); cell.classList.remove("marked"); }
    else { gameState.markedNumbers.add(number); cell.classList.add("marked"); }
    if (checkForBingo() && !gameState.hasClaimedBingo) updateBingoButton();
}
window.handlePlayerCardClick = handlePlayerCardClick;

function getUserId() {
    let userId = null;
    const urlParams = new URLSearchParams(window.location.search); const userIdFromUrl = urlParams.get("user_id"); if (userIdFromUrl) userId = userIdFromUrl;
    if (!userId && window.Telegram && Telegram.WebApp) { try { const user = Telegram.WebApp.initDataUnsafe?.user; if (user && user.id) userId = user.id.toString(); } catch (error) {} }
    if (!userId) { let storedUserId = localStorage.getItem("haset_bingo_user_id"); if (!storedUserId) { storedUserId = Math.floor(Math.random() * 1000000) + 1; localStorage.setItem("haset_bingo_user_id", storedUserId); } userId = storedUserId; }
    return userId;
}

async function fetchUserCardForGame(gameId) {
    try {
        const response = await fetch(`${API_BASE_URL}/game/${gameId}/user-state/${gameState.userId}`);
        if (!response.ok) { if (response.status === 404) { gameState.hasCard = false; return false; } throw new Error(`HTTP ${response.status}`); }
        const data = await response.json();
        if (data.success && data.has_card && data.user_card) {
            gameState.hasCard = true; gameState.selectedCardId = data.user_card.card_id; gameState.selectedCardIndex = data.user_card.card_index;
            if (data.user_card.card_data) {
                try {
                    let cardData = data.user_card.card_data; if (typeof cardData === "string") cardData = JSON.parse(cardData);
                    if (Array.isArray(cardData)) gameState.selectedCardNumbers = cardData;
                    else if (cardData && typeof cardData === "object") { if (cardData.numbers && Array.isArray(cardData.numbers)) gameState.selectedCardNumbers = cardData.numbers; else if (cardData.grid && Array.isArray(cardData.grid)) { const flattened = []; for (const row of cardData.grid) { if (Array.isArray(row)) flattened.push(...row); } gameState.selectedCardNumbers = flattened; } else if (Array.isArray(cardData.cells)) gameState.selectedCardNumbers = cardData.cells.map((cell) => cell.number || cell); }
                } catch (e) { console.error("Error parsing card data:", e); gameState.selectedCardNumbers = generateFallbackCardNumbers(); }
            } else gameState.selectedCardNumbers = generateFallbackCardNumbers();
            gameState.markedNumbers.clear();
            document.getElementById("selected-card-id").textContent = `#${data.user_card.card_index || "0"}`;
            document.getElementById("player-card-id").textContent = data.user_card.card_index || "0";
            if (gameState.gamePhase === "active" || gameState.gameStatus === "active") renderPlayerCard();
            return true;
        } else { gameState.hasCard = false; return false; }
    } catch (error) { console.error("Error fetching user card:", error); gameState.hasCard = false; return false; }
}

function generateFallbackCardNumbers() {
    const numbers = []; for (let i = 0; i < 25; i++) { if (i === 12) numbers.push(0); else numbers.push(Math.floor(Math.random() * 75) + 1); } return numbers;
}

function sendWebSocketMessage(message) {
    if (!message.timestamp) message.timestamp = Date.now();
    if (gameState.websocket && gameState.websocket.readyState === WebSocket.OPEN) {
        try { gameState.websocket.send(JSON.stringify(message)); return true; } catch (error) { console.error("Error sending WebSocket message:", error); gameState.pendingMessages.push(message); return false; }
    } else {
        gameState.pendingMessages.push(message);
        if (!gameState.isReconnecting && gameState.reconnectAttempts < gameState.maxReconnectAttempts) { gameState.isReconnecting = true; initWebSocket(); }
        return false;
    }
}

async function initWebSocket() {
    try {
        const wsUrl = `${WS_BASE_URL}/ws`;
        gameState.reconnectAttempts++; gameState.connectionRetryCount++;
        if (gameState.reconnectAttempts > 1) { console.log(`WebSocket reconnection attempt #${gameState.reconnectAttempts}`); updateConnectionStatus(`Reconnecting (${gameState.reconnectAttempts})...`, "orange"); }
        if (gameState.reconnectAttempts > gameState.maxReconnectAttempts) { console.error("Max WebSocket reconnection attempts reached"); updateConnectionStatus("Connection failed - please refresh", "red"); return; }
        if (gameState.websocket) { try { gameState.websocket.onclose = null; gameState.websocket.close(); } catch (e) {} }
        console.log(`Connecting to WebSocket (attempt ${gameState.connectionRetryCount}/${gameState.maxConnectionRetries}): ${wsUrl}`);
        gameState.websocket = new WebSocket(wsUrl);
        gameState.websocket.onopen = function () {
            console.log("WebSocket connected successfully"); gameState.isConnected = true; gameState.connectionRetryCount = 0; gameState.reconnectAttempts = 0; gameState.isReconnecting = false; updateConnectionStatus("Connected", "green");
            sendWebSocketMessage({ type: "auth", userId: gameState.userId, gameId: gameState.gameId, timestamp: Date.now() });
            setTimeout(() => { if (gameState.gameId) { console.log("Requesting full game state after reconnect"); getCompleteGameState(); } }, 500);
            if (gameState.pendingMessages.length > 0) { gameState.pendingMessages.forEach((msg) => { try { gameState.websocket.send(JSON.stringify(msg)); } catch (e) { console.error("Failed to send pending message:", e); } }); gameState.pendingMessages = []; }
            if (gameState.pingInterval) clearInterval(gameState.pingInterval);
            gameState.pingInterval = setInterval(() => { if (gameState.websocket && gameState.websocket.readyState === WebSocket.OPEN) sendWebSocketMessage({ type: "ping", timestamp: Date.now() }); }, 30000);
        };
        gameState.websocket.onmessage = function (event) { try { const data = JSON.parse(event.data); handleWebSocketMessage(data); } catch (error) { console.error("Error parsing WebSocket message:", error); } };
        gameState.websocket.onclose = function (event) {
            console.log("WebSocket disconnected:", event.code, event.reason); gameState.isConnected = false;
            if (gameState.pingInterval) { clearInterval(gameState.pingInterval); gameState.pingInterval = null; }
            if (!gameState.isWinnerDisplayActive && !gameState.gameComplete) updateConnectionStatus("Disconnected - reconnecting...", "orange");
            const delay = Math.min(1000 * Math.pow(1.5, gameState.reconnectAttempts), 30000);
            console.log(`Reconnecting in ${delay}ms...`);
            setTimeout(() => { if (!gameState.isConnected && !gameState.isReconnecting) { gameState.isReconnecting = true; initWebSocket(); } }, delay);
        };
        gameState.websocket.onerror = function (error) { console.error("WebSocket error:", error); };
    } catch (error) {
        console.error("Failed to connect WebSocket:", error); gameState.isConnected = false; updateConnectionStatus("Failed to connect", "red");
        const delay = Math.min(1000 * Math.pow(1.5, gameState.reconnectAttempts), 30000);
        setTimeout(() => { if (!gameState.isConnected && !gameState.isReconnecting) { gameState.isReconnecting = true; initWebSocket(); } }, delay);
    }
}

function instantCardUpdate(cardIndex, newStatus, cardData = null) {
    const cardElement = gameState.cardsCache.cardElements[cardIndex]; if (!cardElement) return;
    cardElement.classList.remove("available", "sold", "owned", "selected", "purchasing");
    switch (newStatus) {
        case "sold": cardElement.classList.add("sold"); cardElement.onclick = null; cardElement.title = "Sold to another player"; gameState.cardsSold.add(cardIndex); gameState.cardsCache.soldCards.add(cardIndex); break;
        case "owned": cardElement.classList.add("owned"); cardElement.onclick = () => handleCardSelection(cardIndex, cardElement); cardElement.title = "Your card"; gameState.cardsSold.add(cardIndex); gameState.cardsCache.soldCards.add(cardIndex); gameState.cardsCache.ownedCardIndex = cardIndex; if (cardData && cardData.numbers) { gameState.selectedCardNumbers = cardData.numbers; gameState.selectedCardIndex = cardIndex; gameState.hasCard = true; document.getElementById("selected-card-id").textContent = `#${cardIndex}`; document.getElementById("player-card-id").textContent = cardIndex; document.getElementById("selected-card-info").style.display = "block"; showCardPreview(); if (gameState.gamePhase === "active" || gameState.gameStatus === "active") renderPlayerCard(); } break;
        case "available": cardElement.classList.add("available"); cardElement.onclick = () => handleCardSelection(cardIndex, cardElement); cardElement.title = "Available to buy"; gameState.cardsSold.delete(cardIndex); gameState.cardsCache.soldCards.delete(cardIndex); break;
        case "selected": cardElement.classList.add("selected"); cardElement.onclick = () => handleCardSelection(cardIndex, cardElement); cardElement.title = "Selected"; gameState.uiSelectedCardIndex = cardIndex; break;
    }
    if (cardData) { if (cardData.prize_pool !== undefined) gameState.prizePool = cardData.prize_pool; if (cardData.total_players !== undefined) gameState.totalPlayers = cardData.total_players; if (cardData.wallet_balance !== undefined) gameState.walletBalance = cardData.wallet_balance; if (cardData.real_players !== undefined) gameState.realPlayers = cardData.real_players; if (cardData.fake_players !== undefined) gameState.fakePlayers = cardData.fake_players; updateGameStats(); }
}

function resetCardsForNewRound() {
    const grid = document.getElementById("cards-grid"); if (!grid) return;
    if (gameState.staggeredAnimationInterval) { clearInterval(gameState.staggeredAnimationInterval); gameState.staggeredAnimationInterval = null; }
    gameState.pendingFakeCardIndices = []; gameState.cardsLoaded = false; gameState.cardsLoadAttempted = false;
    if (grid.children.length === 0) { loadCardsGrid(); return; }
    for (let i = 1; i <= 400; i++) { const cardElement = gameState.cardsCache.cardElements[i]; if (cardElement) { cardElement.classList.remove("available", "sold", "owned", "selected", "purchasing"); cardElement.classList.add("available"); cardElement.onclick = () => handleCardSelection(i, cardElement); cardElement.title = "Available to buy"; } }
    gameState.cardsSold.clear(); gameState.cardsCache.soldCards.clear(); gameState.cardsCache.ownedCardIndex = null; gameState.selectedCardIndex = null; gameState.hasCard = false; gameState.uiSelectedCardIndex = null;
    document.getElementById("selected-card-info").style.display = "none";
}

async function getCompleteGameState() {
    if (!gameState.gameId) return false;
    if (gameState.fullSyncInProgress) return false;
    gameState.fullSyncInProgress = true;
    try {
        console.log(`Fetching complete game state for game ${gameState.gameId}, user ${gameState.userId}`);
        const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/complete-state/${gameState.userId}`);
        if (!response.ok) { if (response.status === 404) return false; throw new Error(`HTTP ${response.status}`); }
        const data = await response.json();
        if (data.success) {
            gameState.gameId = data.game_id; gameState.gamePhase = data.game_phase; gameState.gameStatus = data.game_status; gameState.lastConfirmedPhase = data.game_phase; gameState.currentRound = data.round_number || gameState.currentRound;
            gameState.prizePool = parseFloat(data.prize_pool || 0); gameState.realPlayers = data.real_players || 0; gameState.fakePlayers = data.fake_players || 0; gameState.totalPlayers = data.total_players || gameState.realPlayers + gameState.fakePlayers;
            gameState.maxWinners = data.max_winners || 2; gameState.winnersCount = data.winners_count || 0; gameState.winners = data.winners || [];
            if (data.called_numbers && Array.isArray(data.called_numbers)) { gameState.calledNumbers = data.called_numbers; }
            if (data.countdown_remaining !== undefined) {
                if (Math.abs(data.countdown_remaining - gameState.countdown) > 2 || gameState.countdownInterval === null) {
                    gameState.countdown = data.countdown_remaining; gameState.countdownTotal = data.countdown_remaining;
                    updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown);
                    if (gameState.gamePhase === "card_purchase") startServerCoordinatedCountdown();
                    if (data.countdown_remaining <= 0 && gameState.gamePhase === "card_purchase") {
                        if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; }
                        const statusElement = document.getElementById("countdown-status-text");
                        if (statusElement) statusElement.textContent = "Game starting...";
                    }
                }
            }
            if (data.user_has_card && data.user_card) {
                gameState.hasCard = true; gameState.selectedCardId = data.user_card.card_id; gameState.selectedCardIndex = data.user_card.card_index;
                if (data.user_card.card_numbers) { try { if (typeof data.user_card.card_numbers === "string") gameState.selectedCardNumbers = JSON.parse(data.user_card.card_numbers); else gameState.selectedCardNumbers = data.user_card.card_numbers; } catch (e) { gameState.selectedCardNumbers = generateFallbackCardNumbers(); } }
                else if (data.user_card.card_data) { try { let cardData = data.user_card.card_data; if (typeof cardData === "string") cardData = JSON.parse(cardData); if (Array.isArray(cardData)) gameState.selectedCardNumbers = cardData; else if (cardData.numbers) gameState.selectedCardNumbers = cardData.numbers; } catch (e) { gameState.selectedCardNumbers = generateFallbackCardNumbers(); } }
                else { gameState.selectedCardNumbers = generateFallbackCardNumbers(); }
                document.getElementById("selected-card-id").textContent = `#${data.user_card.card_index || "0"}`; document.getElementById("player-card-id").textContent = data.user_card.card_index || "0";
            } else { gameState.hasCard = false; gameState.selectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear(); }
            if (data.winners && data.winners.length > 0) {
                gameState.winners = data.winners; gameState.winnersCount = data.winners_count || data.winners.length; gameState.maxWinners = data.max_winners || 2;
                const lastWinner = data.winners[data.winners.length - 1];
                let winningPattern = lastWinner.winning_pattern || lastWinner.marked_numbers || []; if (typeof winningPattern === "string") { try { winningPattern = JSON.parse(winningPattern); } catch (e) { winningPattern = []; } }
                let cardNumbers = lastWinner.card_numbers || []; if ((!cardNumbers || cardNumbers.length === 0) && data.card_numbers) cardNumbers = data.card_numbers;
                gameState.winnerData = { user_id: lastWinner.user_id, username: lastWinner.username, full_name: lastWinner.full_name, prize_amount: parseFloat(lastWinner.prize_amount || 0), card_index: lastWinner.card_index, card_numbers: cardNumbers, winning_pattern: winningPattern, pattern_type: lastWinner.pattern_type || "BINGO", prize_pool: data.prize_pool, game_id: data.game_id, winner_number: lastWinner.winner_number || data.winners.indexOf(lastWinner) + 1, total_winners: data.winners.length, all_winners: data.winners, is_final_winner: data.winners_count >= data.max_winners, corner_details: lastWinner.corner_details || null, column_details: lastWinner.column_details || null };
                gameState.winnerAnnounced = true; gameState.gameComplete = data.winners_count >= data.max_winners;
            } else { gameState.winnerAnnounced = false; gameState.gameComplete = false; }
            updateCalledNumbersDisplay(); if (gameState.calledNumbers.length > 0) updateCurrentCalledDisplay(gameState.calledNumbers[gameState.calledNumbers.length - 1]); else updateCurrentCalledDisplay("--");
            updateBingoGrid(); updateGameStats();
            gameState.purchasePhaseActive = gameState.gamePhase === "card_purchase";
            if (gameState.gamePhase === "card_purchase") { showScreen("waiting-screen"); if (gameState.hasCard) { showCardPreview(); document.getElementById("selected-card-info").style.display = "block"; } else { document.getElementById("selected-card-info").style.display = "none"; } if (!gameState.cardsLoaded && !gameState.cardsLoadAttempted) { gameState.cardsLoadAttempted = true; if (document.getElementById("cards-grid").children.length === 0) { setTimeout(() => { loadCardsGrid().then(() => { gameState.cardsLoaded = true; }); }, 100); } else { updateCardsGridInstant(); gameState.cardsLoaded = true; } } }
            else if (gameState.gamePhase === "active" || gameState.gameStatus === "active") { gameState.gameActive = true; gameState.gameStartConfirmed = true; showScreen("game-screen"); if (gameState.hasCard) renderPlayerCard(); else renderEmptyPlayerCard(); }
            else if (gameState.gamePhase === "winner_display" && gameState.winnerData) showWinnerAnnouncementScreen(gameState.winnerData);
            updateBingoButton(); gameState.lastFullSyncTime = Date.now(); return true;
        } else { return false; }
    } catch (error) { console.error("Error fetching complete game state:", error); return false; } finally { gameState.fullSyncInProgress = false; }
}
window.getCompleteGameState = getCompleteGameState;

function updateGameStats() {
    document.getElementById("card-price").textContent = `${CARD_PRICE.toFixed(2)} birr`;
    document.getElementById("wallet-balance").textContent = `${gameState.walletBalance.toFixed(2)} birr`;
    document.getElementById("game-prize-pool").textContent = `${gameState.prizePool.toFixed(2)} birr`;
    if (gameState.totalPlayers > 0) document.getElementById("game-player-count").textContent = gameState.totalPlayers;
    else document.getElementById("game-player-count").textContent = gameState.realPlayers + gameState.fakePlayers;
    document.getElementById("called-numbers-stat").textContent = gameState.calledNumbers.length;
    document.getElementById("called-count").textContent = gameState.calledNumbers.length;
    document.getElementById("current-round-number").textContent = gameState.currentRound;
}

function startServerCoordinatedCountdown() {
    if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; }
    if (gameState.gamePhase !== "card_purchase") return;
    if (!gameState.cardsLoaded && !gameState.cardsLoadAttempted) { gameState.cardsLoadAttempted = true; gameState.countdownStartTime = Date.now(); if (document.getElementById("cards-grid").children.length === 0) { loadCardsGrid().then(() => { gameState.cardsLoaded = true; }); } else { updateCardsGridInstant(); gameState.cardsLoaded = true; } }
    gameState.countdownInterval = setInterval(() => {}, 10000);
}

async function handleWebSocketMessage(data) {
    console.log("WebSocket message received:", data.type, data); gameState.lastUpdateTime = Date.now();
    if (data.game_id) gameState.gameId = data.game_id;
    switch (data.type) {
        case "winner_confirmed": stopAllAudio(); handleWinnerConfirmed(data); break;
        case "winner_display_started": if (gameState.isWinnerDisplayActive) { const timerElement = document.getElementById("winner-announcement-timer"); if (timerElement && data.remaining_seconds) timerElement.textContent = `New round starting in ${data.remaining_seconds} seconds...`; } break;
        case "winner_display_countdown": if (gameState.isWinnerDisplayActive) { const timerElement = document.getElementById("winner-announcement-timer"); if (timerElement && data.remaining_seconds !== undefined) timerElement.textContent = `New round starting in ${data.remaining_seconds} seconds...`; } break;
        case "winner_display_completed": handleWinnerDisplayCompleted(data); break;
        case "game_completed": const winnerAnnouncement = document.getElementById("winner-announcement"); if (winnerAnnouncement) winnerAnnouncement.style.display = "none"; gameState.gameComplete = true; gameState.winnerAnnounced = false; gameState.isWinnerDisplayActive = false; handleWinnerDisplayCompleted(data); break;
        case "existing_game_resumed": handleExistingGameResumed(data); break;
        case "new_game_started": handleNewRoundStarted(data); setTimeout(() => getCompleteGameState(), 1000); break;
        case "bingo_claim_verified": handleBingoClaimVerified(data); break;
        case "bingo_rejected": handleBingoRejected(data); break;
        case "phase_change_confirmed": handlePhaseChangeConfirmed(data); break;
        case "force_sync": getCompleteGameState(); break;
        case "player_joined": if (data.total_players !== undefined) { gameState.totalPlayers = data.total_players; gameState.realPlayers = data.real_players || gameState.realPlayers; gameState.fakePlayers = data.fake_players || gameState.fakePlayers; updateGameStats(); } break;
        case "player_left": if (data.total_players !== undefined) { gameState.totalPlayers = data.total_players; gameState.realPlayers = data.real_players || gameState.realPlayers; gameState.fakePlayers = data.fake_players || gameState.fakePlayers; updateGameStats(); } break;
        case "card_purchased": if (data.prize_pool !== undefined) gameState.prizePool = data.prize_pool; if (data.total_players !== undefined) { gameState.totalPlayers = data.total_players; gameState.realPlayers = data.real_players || gameState.realPlayers; gameState.fakePlayers = data.fake_players || gameState.fakePlayers; updateGameStats(); } if (gameState.gamePhase === "card_purchase" && data.card_index) { const cardIndex = data.card_index; if (cardIndex !== gameState.selectedCardIndex) instantCardUpdate(cardIndex, "sold"); } break;
        case "number_called": if (data.game_id === gameState.gameId && data.number) handleServerNumberCalled(data.number, data.called_numbers || []); break;
        case "game_update": if (data.data) { if (data.data.status === "winner_display" && gameState.winnerAnnounced) return; handleCriticalGameUpdate(data.data); } break;
        case "new_round_started": handleNewRoundStarted(data); setTimeout(() => getCompleteGameState(), 1000); break;
        case "sync_response": if (data.server_state) updateFromServerState(data.server_state); break;
        case "auth_success": gameState.connectionRetryCount = 0; gameState.reconnectAttempts = 0; break;
        case "welcome": updateConnectionStatus("Connected", "green"); break;
        case "countdown_reset": if (data.new_countdown !== undefined) { gameState.countdown = data.new_countdown; gameState.countdownTotal = data.new_countdown; updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown); if (gameState.gamePhase === "card_purchase") startServerCoordinatedCountdown(); } break;
        case "countdown_update": if (data.seconds_remaining !== undefined) { gameState.countdown = data.seconds_remaining; updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown); if (data.seconds_remaining <= 0 && gameState.gamePhase === "card_purchase") { if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; } const statusElement = document.getElementById("countdown-status-text"); if (statusElement) statusElement.textContent = "Game starting..."; getCompleteGameState(); } } break;
        case "fake_card_purchased": if (data.prize_pool !== undefined) gameState.prizePool = data.prize_pool; if (data.total_players !== undefined) gameState.totalPlayers = data.total_players; if (data.fake_players !== undefined) gameState.fakePlayers = data.fake_players; if (data.real_players !== undefined) gameState.realPlayers = data.real_players; updateGameStats(); if (data.card_index) instantCardUpdate(data.card_index, "sold"); break;
        case "fake_users_added": if (data.prize_pool !== undefined) gameState.prizePool = data.prize_pool; if (data.total_players !== undefined) gameState.totalPlayers = data.total_players; if (data.total_fake_players !== undefined) gameState.fakePlayers = data.total_fake_players; if (data.real_players !== undefined) gameState.realPlayers = data.real_players; updateGameStats(); if (data.fake_card_indices && Array.isArray(data.fake_card_indices) && data.fake_card_indices.length > 0) { if (!gameState.cardsLoaded && document.getElementById("cards-grid").children.length === 0) { loadCardsGrid().then(() => { updateFakeCardsImmediately(data.fake_card_indices); }); } else { updateFakeCardsImmediately(data.fake_card_indices); } } break;
        case "early_state_update": if (data.prize_pool !== undefined) gameState.prizePool = data.prize_pool; if (data.total_players !== undefined) gameState.totalPlayers = data.total_players; if (data.fake_players !== undefined) gameState.fakePlayers = data.fake_players; if (data.real_players !== undefined) gameState.realPlayers = data.real_players; if (data.countdown !== undefined) { gameState.countdown = data.countdown; updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown); } updateGameStats(); if (data.fake_card_indices && Array.isArray(data.fake_card_indices) && data.fake_card_indices.length > 0) { if (!gameState.cardsLoaded && document.getElementById("cards-grid").children.length === 0) { loadCardsGrid().then(() => { updateFakeCardsImmediately(data.fake_card_indices); }); } else { updateFakeCardsImmediately(data.fake_card_indices); } } break;
        case "pong": break;
        case "full_state_update": if (gameState.gamePhase === "card_purchase" && gameState.cardsLoaded) { if (data.game_state) { if (data.game_state.prize_pool !== undefined) gameState.prizePool = data.game_state.prize_pool; if (data.game_state.real_players !== undefined) gameState.realPlayers = data.game_state.real_players; if (data.game_state.fake_players !== undefined) gameState.fakePlayers = data.game_state.fake_players; if (data.game_state.total_players !== undefined) gameState.totalPlayers = data.game_state.total_players; if (data.game_state.player_count !== undefined) gameState.playerCount = data.game_state.player_count; if (data.game_state.game_phase) { gameState.gamePhase = data.game_state.game_phase; gameState.gameStatus = data.game_state.game_phase; gameState.lastConfirmedPhase = data.game_state.game_phase; } updateGameStats(); } break; } if (data.game_state) { if (data.game_state.called_numbers) { gameState.calledNumbers = data.game_state.called_numbers; updateCalledNumbersDisplay(); updateBingoGrid(); } if (data.game_state.prize_pool !== undefined) gameState.prizePool = data.game_state.prize_pool; if (data.game_state.real_players !== undefined) gameState.realPlayers = data.game_state.real_players; if (data.game_state.fake_players !== undefined) gameState.fakePlayers = data.game_state.fake_players; if (data.game_state.total_players !== undefined) gameState.totalPlayers = data.game_state.total_players; if (data.game_state.player_count !== undefined) gameState.playerCount = data.game_state.player_count; if (data.game_state.game_phase) { gameState.gamePhase = data.game_state.game_phase; gameState.gameStatus = data.game_state.game_phase; gameState.lastConfirmedPhase = data.game_state.game_phase; } updateGameStats(); updateGameUI(); } break;
        default: console.log("Unknown WebSocket message type:", data.type, data);
    }
}

function handleWinnerConfirmed(data) {
    if (!data) return; stopAllAudio(); let winnerData = null; let winnersList = [];
    if (data.winners && Array.isArray(data.winners) && data.winners.length > 0) { winnersList = data.winners; winnerData = winnersList[winnersList.length - 1]; if (winnerData) { if (!winnerData.card_numbers && data.card_numbers) winnerData.card_numbers = data.card_numbers; if (!winnerData.winning_pattern && data.winning_pattern) winnerData.winning_pattern = data.winning_pattern; } } else if (data.user_id) { winnersList = [data]; winnerData = data; }
    if (!winnerData || winnersList.length === 0) return;
    let winningPattern = winnerData.winning_pattern || winnerData.marked_numbers || []; if (data.winning_pattern && (!winningPattern || winningPattern.length === 0)) winningPattern = data.winning_pattern;
    if (typeof winningPattern === "string") { try { winningPattern = JSON.parse(winningPattern); } catch (e) { winningPattern = []; } }
    if (!Array.isArray(winningPattern)) winningPattern = [];
    let cardNumbers = [];
    if (winnerData.card_numbers && Array.isArray(winnerData.card_numbers) && winnerData.card_numbers.length > 0) cardNumbers = winnerData.card_numbers;
    else if (data.card_numbers && Array.isArray(data.card_numbers) && data.card_numbers.length > 0) cardNumbers = data.card_numbers;
    else if (data.corner_details && data.corner_details.corner_indices) { cardNumbers = Array(25).fill("?"); const cornerIndices = data.corner_details.corner_indices || [0, 4, 20, 24]; const cornerNumbers = [data.corner_details.top_left, data.corner_details.top_right, data.corner_details.bottom_left, data.corner_details.bottom_right]; cornerIndices.forEach((index, i) => { if (index < 25 && cornerNumbers[i]) cardNumbers[index] = cornerNumbers[i]; }); cardNumbers[12] = 0; }
    const processedWinners = winnersList.map((winner) => { if (!winner.card_numbers || winner.card_numbers.length === 0) { if (data.card_numbers) winner.card_numbers = data.card_numbers; else if (cardNumbers.length > 0) winner.card_numbers = cardNumbers; } return winner; });
    gameState.winners = processedWinners; gameState.winnersCount = processedWinners.length; gameState.maxWinners = data.max_winners || 2; gameState.gameComplete = data.is_final_winner || processedWinners.length >= gameState.maxWinners;
    gameState.winnerData = { user_id: winnerData.user_id, full_name: winnerData.full_name || data.full_name || "Unknown Player", username: winnerData.username || data.username || `User ${winnerData.user_id}`, prize_amount: parseFloat(winnerData.prize_amount || data.prize_amount || 0), card_index: winnerData.card_index || data.card_index || 0, card_numbers: cardNumbers, winning_pattern: winningPattern, pattern_type: winnerData.pattern_type || data.pattern_type || "BINGO", prize_pool: parseFloat(data.prize_pool || 0), game_id: data.game_id || winnerData.game_id, winner_number: winnerData.winner_number || data.winner_number || 1, total_winners: processedWinners.length, all_winners: processedWinners, is_final_winner: data.is_final_winner || false, corner_details: data.corner_details || winnerData.corner_details || null, column_details: data.column_details || winnerData.column_details || null };
    clearInterval(gameState.numberCallInterval); gameState.numberCallInterval = null;
    if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; }
    gameState.winnerAnnounced = true; gameState.hasClaimedBingo = winnerData.user_id == gameState.userId; gameState.bingoClaimInProgress = false; gameState.phaseChangeRequested = false;
    if (winnerData.user_id == gameState.userId) getUserBalance();
    if (gameState.audioEnabled && gameState.audioInitialized) playWinnerSound();
    showWinnerAnnouncementScreen(gameState.winnerData);
}

function showWinnerAnnouncementScreen(winnerData) {
    const announcement = document.getElementById("winner-announcement");
    const winnersCompactContainer = document.getElementById("winners-compact-container");
    const multipleWinnersHeader = document.getElementById("multiple-winners-header");
    const winnersNamesContainer = document.getElementById("winners-names-container");
    const timerElement = document.getElementById("winner-announcement-timer");
    if (!announcement) return;
    if (!winnerData) winnerData = gameState.winnerData || { full_name: "Unknown Winner", username: "unknown", prize_amount: 0, card_index: 0, card_numbers: [], winning_pattern: [], pattern_type: "BINGO", all_winners: [] };
    winnersCompactContainer.innerHTML = "";
    const allWinners = winnerData.all_winners || [winnerData]; const winnerCount = allWinners.length;
    if (winnerCount > 1 && multipleWinnersHeader && winnersNamesContainer) { multipleWinnersHeader.style.display = "block"; winnersNamesContainer.innerHTML = ""; allWinners.forEach((winner, index) => { const nameSpan = document.createElement("span"); nameSpan.className = "winner-name-badge"; nameSpan.textContent = winner.full_name || winner.username || `Winner ${index + 1}`; winnersNamesContainer.appendChild(nameSpan); if (index < winnerCount - 1) { const andSpan = document.createElement("span"); andSpan.className = "and-separator"; andSpan.textContent = "and"; winnersNamesContainer.appendChild(andSpan); } }); } else if (multipleWinnersHeader) { multipleWinnersHeader.style.display = "none"; }
    allWinners.forEach((winner, index) => {
        const winnerCard = document.createElement("div"); winnerCard.className = "winner-compact-card";
        const cardNumbers = winner.card_numbers || winnerData.card_numbers || []; const winningPattern = winner.winning_pattern || winnerData.winning_pattern || []; const patternSet = new Set();
        if (Array.isArray(winningPattern)) winningPattern.forEach((num) => { if (num !== 0 && num !== "0" && num !== null && num !== undefined) patternSet.add(num.toString()); });
        const isFourCorners = (winner.pattern_type || winnerData.pattern_type) === "four_corners"; const cornerIndices = [0, 4, 20, 24]; const cardIndex = winner.card_index || index + 1;
        let cardHTML = `<div class="winner-compact-header"><span class="winner-compact-name">${winner.full_name || winner.username || `Winner ${index + 1}`}</span><span class="winner-compact-prize">Card #${cardIndex} • ${winner.prize_amount || winnerData.prize_amount || 0} birr</span></div><div class="winner-card-grid-display">`;
        for (let i = 0; i < 25; i++) { const num = cardNumbers[i] !== undefined ? cardNumbers[i] : "?"; const isFree = i === 12 || num === 0 || num === "0" || num === "FREE"; const numStr = num.toString(); const isMarked = patternSet.has(numStr) || (isFourCorners && cornerIndices.includes(i)); cardHTML += `<div class="winner-card-cell ${isFree ? "free" : ""} ${isMarked ? "marked" : ""}">${isFree ? "FREE" : num}</div>`; }
        cardHTML += "</div>";
        if (index === 0 && winningPattern.length > 0) { const filteredPattern = winningPattern.filter((num) => num !== 0 && num !== "0" && num !== null && num !== undefined); if (filteredPattern.length > 0) { cardHTML += `<div class="winning-pattern-display"><div class="winning-pattern-title"><i class="fas fa-star"></i> WINNING NUMBERS <i class="fas fa-star"></i></div><div class="winning-pattern-numbers">${filteredPattern.map((num) => `<span class="winning-pattern-number">${num}</span>`).join("")}</div></div>`; } }
        winnerCard.innerHTML = cardHTML; winnersCompactContainer.appendChild(winnerCard);
    });
    startWinnerDisplayCountdown(winnerData.game_id, 10); announcement.style.display = "flex";
}

function startWinnerDisplayCountdown(gameId, durationSeconds = 10) {
    if (gameState.winnerDisplayInterval) clearInterval(gameState.winnerDisplayInterval);
    gameState.isWinnerDisplayActive = true; gameState.winnerDisplayCountdown = durationSeconds;
    const timerElement = document.getElementById("winner-announcement-timer");
    if (timerElement) timerElement.textContent = `New round starting in ${gameState.winnerDisplayCountdown} seconds...`;
    gameState.winnerDisplayInterval = setInterval(() => {
        gameState.winnerDisplayCountdown--;
        if (timerElement) timerElement.textContent = `New round starting in ${gameState.winnerDisplayCountdown} seconds...`;
        if (gameState.winnerDisplayCountdown <= 0) { clearInterval(gameState.winnerDisplayInterval); gameState.winnerDisplayInterval = null; handleWinnerDisplayCompleted({ game_id: gameId }); }
    }, 1000);
}

function handleWinnerDisplayCompleted(data) {
    const winnerAnnouncement = document.getElementById("winner-announcement");
    if (winnerAnnouncement) winnerAnnouncement.style.display = "none";
    if (gameState.winnerDisplayInterval) { clearInterval(gameState.winnerDisplayInterval); gameState.winnerDisplayInterval = null; }
    gameState.winnerAnnounced = false; gameState.winnerSoundPlayed = false; gameState.gameComplete = false; gameState.isWinnerDisplayActive = false; gameState.winnerData = null; gameState.winners = [];
    gameState.gamePhase = "card_purchase"; gameState.gameStatus = "card_purchase"; gameState.lastConfirmedPhase = "card_purchase"; gameState.gameActive = false; gameState.purchasePhaseActive = true;
    gameState.hasCard = false; gameState.selectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear(); gameState.calledNumbers = [];
    gameState.prizePool = 0; gameState.playerCount = 0; gameState.hasClaimedBingo = false; gameState.bingoClaimInProgress = false; gameState.gameStartConfirmed = false;
    gameState.countdown = 30; gameState.countdownTotal = 30; gameState.cardsLoaded = false; gameState.cardsLoadAttempted = false;
    showScreen("waiting-screen");
    updateCalledNumbersDisplay(); updateCurrentCalledDisplay("--"); updateBingoGrid(); renderEmptyPlayerCard(); updateGameStats();
    document.getElementById("selected-card-info").style.display = "none"; resetCardsForNewRound();
    setTimeout(() => { fetchActiveGame().then((gameData) => { if (gameData && gameData.success) { gameState.gameId = gameData.game_id; gameState.currentRound = gameData.round_number || gameState.currentRound + 1; gameState.countdown = gameData.countdown_remaining || 0; gameState.countdownTotal = gameData.countdown_remaining || 30; document.getElementById("current-round-number").textContent = gameState.currentRound; startServerCoordinatedCountdown(); } }); }, 200);
}

function handleNewRoundStarted(data) {
    if (gameState.staggeredAnimationInterval) { clearInterval(gameState.staggeredAnimationInterval); gameState.staggeredAnimationInterval = null; } gameState.pendingFakeCardIndices = [];
    const winnerAnnouncement = document.getElementById("winner-announcement");
    if (winnerAnnouncement) winnerAnnouncement.style.display = "none";
    if (gameState.winnerDisplayInterval) { clearInterval(gameState.winnerDisplayInterval); gameState.winnerDisplayInterval = null; }
    if (gameState.gamePhase === "card_purchase" && gameState.cardsLoaded) { gameState.gameId = data.game_id; gameState.currentRound = data.round_number || gameState.currentRound + 1; gameState.countdown = data.countdown_seconds || 0; gameState.countdownTotal = data.countdown_seconds || 30; document.getElementById("current-round-number").textContent = gameState.currentRound; startServerCoordinatedCountdown(); return; }
    gameState.gameId = data.game_id; gameState.gamePhase = data.phase || "card_purchase"; gameState.gameStatus = data.status || "card_purchase"; gameState.lastConfirmedPhase = data.phase || "card_purchase";
    gameState.gameActive = false; gameState.purchasePhaseActive = true; gameState.currentRound = data.round_number || gameState.currentRound + 1; gameState.countdown = data.countdown_seconds || 0; gameState.countdownTotal = data.countdown_seconds || 30;
    gameState.gameComplete = false; gameState.winnerAnnounced = false; gameState.isWinnerDisplayActive = false; gameState.winnerData = null; gameState.winners = []; gameState.gameStartConfirmed = false;
    gameState.hasCard = false; gameState.selectedCardId = null; gameState.selectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear(); gameState.calledNumbers = [];
    gameState.hasClaimedBingo = false; gameState.bingoClaimInProgress = false; gameState.isCardOperationInProgress = false; gameState.cardPurchaseComplete = false; gameState.uiSelectedCardIndex = null;
    gameState.prizePool = 0; gameState.playerCount = 0; gameState.cardsSold = new Set(); gameState.cardsCache.soldCards = new Set(); gameState.cardsCache.ownedCardIndex = null;
    gameState.cardsLoaded = false; gameState.cardsLoadAttempted = false;
    updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown);
    showScreen("waiting-screen"); updateCalledNumbersDisplay(); updateCurrentCalledDisplay("--"); updateBingoGrid(); renderEmptyPlayerCard(); updateBingoButton(); updateGameStats(); resetCardsForNewRound();
    document.getElementById("current-round-number").textContent = gameState.currentRound; startServerCoordinatedCountdown();
}

function handleBingoClaimVerified(data) { gameState.bingoClaimInProgress = false; console.log("BINGO verified"); }
function handleBingoRejected(data) { gameState.bingoClaimInProgress = false; gameState.phaseChangeRequested = false; updateBingoButton(); }

function handleExistingGameResumed(data) {
    if (data.game_id) gameState.gameId = data.game_id;
    if (data.real_players !== undefined) gameState.playerCount = data.real_players + (data.fake_players || 0);
    if (data.total_players !== undefined) gameState.playerCount = data.total_players;
    if (data.prize_pool !== undefined) gameState.prizePool = data.prize_pool;
    if (data.phase) { gameState.gamePhase = data.phase; gameState.gameStatus = data.phase; gameState.lastConfirmedPhase = data.phase; } else { gameState.gamePhase = "card_purchase"; gameState.gameStatus = "card_purchase"; gameState.lastConfirmedPhase = "card_purchase"; }
    gameState.purchasePhaseActive = gameState.gamePhase === "card_purchase"; gameState.hasCard = false; gameState.selectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear(); gameState.calledNumbers = [];
    gameState.cardsSold = new Set(); gameState.cardsCache.soldCards = new Set(); gameState.cardsCache.ownedCardIndex = null;
    showScreen("waiting-screen"); updateGameStats();
    setTimeout(() => {
        if (document.getElementById("cards-grid").children.length === 0) loadCardsGrid();
        else { fetch(`${API_BASE_URL}/game/${gameState.gameId}/sold-cards`).then((res) => res.json()).then((data) => { if (data.success) { const soldCards = new Set(data.sold_cards || []); for (let i = 1; i <= 400; i++) { const cardElement = gameState.cardsCache.cardElements[i]; if (cardElement) { if (soldCards.has(i)) { cardElement.classList.remove("available", "owned", "selected"); cardElement.classList.add("sold"); cardElement.onclick = null; } else { cardElement.classList.remove("sold", "owned", "selected"); cardElement.classList.add("available"); cardElement.onclick = () => handleCardSelection(i, cardElement); } } } gameState.cardsSold = soldCards; gameState.cardsCache.soldCards = soldCards; } }); }
        document.getElementById("selected-card-info").style.display = "none";
    }, 500);
    setTimeout(() => { checkUserCardStatus(); }, 1000);
}

function handlePhaseChangeConfirmed(data) {
    if (gameState.winnerAnnounced && (data.phase === "winner_display" || data.phase === "card_purchase")) return;
    gameState.gamePhase = data.phase; gameState.gameStatus = data.phase; gameState.lastConfirmedPhase = data.phase; gameState.phaseChangeRequested = false; gameState.purchasePhaseActive = data.phase === "card_purchase";
    if (data.phase === "active") { gameState.gameStartConfirmed = true; const bingoBtn = document.getElementById("claim-bingo-btn"); if (bingoBtn) { bingoBtn.innerHTML = `<div class="loading-spinner"></div> Loading card...`; bingoBtn.disabled = true; } setTimeout(async () => { await fetchUserCardForGame(gameState.gameId); await syncWithServer(); updateGameUI(); }, 500); }
    if (data.phase === "card_purchase" && data.countdown_seconds) { gameState.countdown = data.countdown_seconds; gameState.countdownTotal = data.countdown_seconds; gameState.gameStartConfirmed = false; startServerCoordinatedCountdown(); setTimeout(() => { if (document.getElementById("cards-grid").children.length === 0) loadCardsGrid(); else updateCardsGridInstant(); }, 500); }
    updateGameUI();
}

function handleCriticalGameUpdate(data) {
    if (data.prize_pool !== undefined) { gameState.prizePool = parseFloat(data.prize_pool); updateGameStats(); }
    if (data.total_players !== undefined) { gameState.playerCount = data.total_players; updateGameStats(); }
    if (data.status && data.status !== gameState.gamePhase) {
        if (gameState.winnerAnnounced && data.status === "winner_display") return;
        gameState.gamePhase = data.status; gameState.gameStatus = data.status; gameState.lastConfirmedPhase = data.status; gameState.purchasePhaseActive = data.status === "card_purchase";
        if (data.status === "active") { gameState.gameStartConfirmed = true; setTimeout(() => { fetchUserCardForGame(gameState.gameId); }, 500); }
        updateGameUI();
    }
}

function updateFromServerState(serverState) {
    if (serverState.countdown_remaining !== undefined) {
        const diff = Math.abs(serverState.countdown_remaining - gameState.countdown);
        if (diff > 2 && serverState.countdown_remaining > 5) { gameState.countdown = serverState.countdown_remaining; updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown); } else if (diff > 5) { gameState.countdown = serverState.countdown_remaining; updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown); }
        if (serverState.countdown_remaining <= 0 && gameState.gamePhase === "card_purchase") {
            if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; }
            const statusElement = document.getElementById("countdown-status-text");
            if (statusElement) statusElement.textContent = "Game starting...";
            getCompleteGameState();
        }
    }
    if (serverState.game_phase && serverState.game_phase !== gameState.gamePhase) {
        if (gameState.winnerAnnounced && serverState.game_phase === "winner_display") return;
        gameState.gamePhase = serverState.game_phase; gameState.gameStatus = serverState.game_phase; gameState.lastConfirmedPhase = serverState.game_phase; gameState.gameActive = serverState.game_active || false; gameState.purchasePhaseActive = serverState.game_phase === "card_purchase";
        if (serverState.game_phase === "active") { gameState.gameStartConfirmed = true; setTimeout(() => { fetchUserCardForGame(gameState.gameId); }, 500); }
        updateGameUI();
    } else if (serverState.status && serverState.status !== gameState.gameStatus) {
        gameState.gameStatus = serverState.status; gameState.gamePhase = serverState.status; gameState.lastConfirmedPhase = serverState.status; gameState.gameActive = serverState.status === "active" || serverState.status === "game_play"; gameState.purchasePhaseActive = serverState.status === "card_purchase";
        if (serverState.status === "active") { gameState.gameStartConfirmed = true; setTimeout(() => { fetchUserCardForGame(gameState.gameId); }, 500); }
        updateGameUI();
    }
    if (serverState.called_numbers && Array.isArray(serverState.called_numbers)) {
        if (JSON.stringify(serverState.called_numbers) !== JSON.stringify(gameState.calledNumbers)) {
            gameState.calledNumbers = serverState.called_numbers; updateCalledNumbersDisplay(); updateBingoGrid();
            if (gameState.calledNumbers.length > 0) { const latestNumber = gameState.calledNumbers[gameState.calledNumbers.length - 1]; updateCurrentCalledDisplay(latestNumber); }
        }
    }
    if (serverState.player_count !== undefined) gameState.playerCount = serverState.player_count;
    if (serverState.prize_pool !== undefined) gameState.prizePool = serverState.prize_pool;
    updateGameStats();
}

async function syncWithServer() {
    if (!gameState.gameId) return;
    if (gameState.isWinnerDisplayActive) return;
    try {
        const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/sync`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: gameState.userId, called_numbers: gameState.calledNumbers, game_phase: gameState.gamePhase,
                countdown: gameState.countdown, has_card: gameState.hasCard, selected_card_index: gameState.selectedCardIndex,
                timestamp: Date.now(), need_full_sync: gameState.lastFullSyncTime === 0 || Date.now() - gameState.lastFullSyncTime > 60000
            }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.recommend_full_sync) { setTimeout(() => getCompleteGameState(), 500); return; }
        if (data.server_state) updateFromServerState(data.server_state);
        gameState.lastSyncTime = Date.now();
    } catch (error) {
        console.warn("Sync failed:", error.message);
        if (Date.now() - gameState.lastFullSyncTime > 30000) setTimeout(() => getCompleteGameState(), 2000);
    }
}

function showScreen(screenId) {
    document.getElementById("waiting-screen").classList.remove("active");
    document.getElementById("game-screen").classList.remove("active");
    const screen = document.getElementById(screenId);
    if (screen) screen.classList.add("active");
}
window.showScreen = showScreen;

function updateGameUI() {
    if (gameState.isWinnerDisplayActive) return;
    if (gameState.gameComplete && !gameState.isWinnerDisplayActive) { showScreen("waiting-screen"); return; }
    if (gameState.countdownInterval) { clearInterval(gameState.countdownInterval); gameState.countdownInterval = null; }
    if (gameState.numberCallInterval) { clearInterval(gameState.numberCallInterval); gameState.numberCallInterval = null; }
    const isGamePlayPhase = gameState.gamePhase === "game_play" || gameState.gameStatus === "active" || gameState.gameStatus === "game_play";
    if (gameState.gamePhase === "card_purchase" || gameState.gameStatus === "card_purchase") {
        showScreen("waiting-screen");
        updateCountdownDisplay(gameState.countdown); updateCountdownStatusText(gameState.countdown);
        if (!gameState.hasCard) document.getElementById("selected-card-info").style.display = "none";
        else document.getElementById("selected-card-info").style.display = "block";
        if (gameState.purchasePhaseActive && !gameState.cardsLoaded && !gameState.cardsLoadAttempted) {
            gameState.cardsLoadAttempted = true;
            if (document.getElementById("cards-grid").children.length === 0) setTimeout(() => { loadCardsGrid().then(() => { gameState.cardsLoaded = true; }); }, 100);
            else { updateCardsGridInstant(); gameState.cardsLoaded = true; }
        }
        document.getElementById("current-round-number").textContent = gameState.currentRound; gameState.gameActive = false;
    } else if (isGamePlayPhase) {
        gameState.gameActive = true; gameState.purchasePhaseActive = false; showScreen("game-screen");
        updateCalledNumbersDisplay(); updateCurrentCalledDisplay(); updateBingoGrid();
        if (gameState.hasCard && Array.isArray(gameState.selectedCardNumbers) && gameState.selectedCardNumbers.length > 0) renderPlayerCard();
        else renderEmptyPlayerCard();
        setTimeout(() => { updateCalledNumbersDisplay(); if (gameState.calledNumbers.length > 0) { updateCurrentCalledDisplay(gameState.calledNumbers[gameState.calledNumbers.length - 1]); updateBingoGrid(); } }, 100);
    } else if (gameState.gamePhase === "winner_display" || gameState.gameStatus === "winner_display") {
        gameState.gameActive = false; gameState.purchasePhaseActive = false;
        if (!gameState.isWinnerDisplayActive) showScreen("waiting-screen");
    } else { showScreen("waiting-screen"); }
    updateGameStats();
}

function updateCountdownDisplay(seconds) {
    const timerElement = document.getElementById("countdown-timer");
    const progressBar = document.getElementById("countdown-progress-bar");
    if (timerElement) timerElement.textContent = seconds;
    if (progressBar && gameState.countdownTotal > 0) {
        const progress = ((gameState.countdownTotal - seconds) / gameState.countdownTotal) * 100;
        progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    }
}

function updateCountdownStatusText(seconds) {
    const statusElement = document.getElementById("countdown-status-text");
    if (statusElement) {
        if (typeof seconds === "string") statusElement.textContent = seconds;
        else if (seconds > 0) statusElement.textContent = `${seconds} second${seconds !== 1 ? "s" : ""} remaining`;
        else statusElement.textContent = "Starting game...";
    }
}

function updateBingoGrid() {
    const columnsContainer = document.getElementById("bingo-grid"); if (!columnsContainer) return;
    columnsContainer.innerHTML = "";
    const columnRanges = [{ letter: "B", min: 1, max: 15 }, { letter: "I", min: 16, max: 30 }, { letter: "N", min: 31, max: 45 }, { letter: "G", min: 46, max: 60 }, { letter: "O", min: 61, max: 75 }];
    columnRanges.forEach((col) => {
        const columnDiv = document.createElement("div"); columnDiv.className = "bingo-column";
        for (let num = col.min; num <= col.max; num++) {
            const cell = document.createElement("div"); cell.className = "bingo-number-cell"; cell.textContent = num;
            if (gameState.calledNumbers.includes(num)) cell.classList.add("called");
            columnDiv.appendChild(cell);
        }
        columnsContainer.appendChild(columnDiv);
    });
}

function showCardPreview() {
    const previewGrid = document.getElementById("card-preview-grid");
    if (!previewGrid || !Array.isArray(gameState.selectedCardNumbers)) return;
    previewGrid.innerHTML = "";
    if (gameState.selectedCardNumbers && Array.isArray(gameState.selectedCardNumbers)) {
        gameState.selectedCardNumbers.forEach((num, index) => {
            const cell = document.createElement("div"); cell.className = "card-preview-cell";
            if (num === 0 || num === "0") { cell.classList.add("free"); cell.textContent = "FREE"; } else { cell.textContent = num; }
            previewGrid.appendChild(cell);
        });
    }
}

function renderPlayerCard() {
    const grid = document.getElementById("player-card-grid");
    if (!grid || !Array.isArray(gameState.selectedCardNumbers)) { renderEmptyPlayerCard(); return; }
    grid.innerHTML = ""; document.getElementById("player-card-id").textContent = gameState.selectedCardIndex || "None";
    if (gameState.selectedCardNumbers && Array.isArray(gameState.selectedCardNumbers)) {
        gameState.selectedCardNumbers.forEach((num, index) => {
            const cell = document.createElement("div"); cell.className = "player-card-cell"; cell.dataset.number = num; cell.dataset.index = index;
            if (num === 0 || num === "0") { cell.className += " free"; cell.textContent = "FREE"; }
            else { cell.textContent = num; if (gameState.markedNumbers.has(num)) cell.classList.add("marked"); cell.onclick = () => handlePlayerCardClick(cell, num); }
            grid.appendChild(cell);
        });
    } else { renderEmptyPlayerCard(); return; }
    updateBingoButton();
}

function renderEmptyPlayerCard() {
    const grid = document.getElementById("player-card-grid"); if (!grid) return;
    grid.innerHTML = ""; document.getElementById("player-card-id").textContent = "None";
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement("div"); cell.className = "player-card-cell empty";
        if (i === 12) { cell.textContent = "FREE"; cell.style.color = "var(--brand-primary)"; cell.style.fontWeight = "bold"; } 
        else { cell.textContent = "?"; cell.style.opacity = "0.3"; cell.style.cursor = "default"; }
        grid.appendChild(cell);
    }
    const bingoBtn = document.getElementById("claim-bingo-btn");
    if (bingoBtn) { bingoBtn.innerHTML = `<i class="fas fa-shopping-cart"></i> Buy Card to Play`; bingoBtn.className = "bingo-btn bingo-btn-inactive"; bingoBtn.disabled = true; }
}

function updateCalledNumbersDisplay() {
    const grid = document.getElementById("called-numbers-grid");
    const countElement = document.getElementById("called-numbers-stat");
    const calledCountElement = document.getElementById("called-count");
    if (grid) {
        grid.innerHTML = "";
        const recentNumbers = gameState.calledNumbers.slice(-3);
        recentNumbers.forEach((num) => {
            const bubble = document.createElement("div"); bubble.className = "called-number"; bubble.textContent = num;
            if (num === gameState.calledNumbers[gameState.calledNumbers.length - 1]) bubble.classList.add("recent");
            grid.appendChild(bubble);
        });
        if (grid.scrollHeight > grid.clientHeight) grid.scrollTop = grid.scrollHeight;
    }
    if (countElement) countElement.textContent = gameState.calledNumbers.length;
    if (calledCountElement) calledCountElement.textContent = gameState.calledNumbers.length;
}

function updateCardsGridInstant() {
    const grid = document.getElementById("cards-grid"); if (!grid) return;
    for (let i = 1; i <= 400; i++) {
        const cardElement = gameState.cardsCache.cardElements[i]; if (!cardElement) continue;
        cardElement.classList.remove("available", "sold", "owned", "selected", "purchasing");
        const isOwned = gameState.selectedCardIndex === i; const isSold = gameState.cardsSold.has(i);
        if (isOwned) { cardElement.classList.add("owned"); cardElement.onclick = () => handleCardSelection(i, cardElement); } else if (isSold) { cardElement.classList.add("sold"); cardElement.onclick = null; } else { cardElement.classList.add("available"); cardElement.onclick = () => handleCardSelection(i, cardElement); }
        if (gameState.uiSelectedCardIndex === i && !isOwned && !isSold) cardElement.classList.add("selected");
    }
}

async function loadCardsGrid() {
    if (gameState.isLoadingCards) return;
    gameState.isLoadingCards = true;
    try {
        if (!gameState.gameId) return;
        const grid = document.getElementById("cards-grid"); if (!grid) return;
        grid.innerHTML = ""; gameState.cardsCache.cardElements = {};
        let soldCards = [];
        try {
            const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/sold-cards`);
            if (response.ok) { const data = await response.json(); if (data.success) { soldCards = data.sold_cards || []; gameState.cardsSold = new Set(soldCards); gameState.cardsCache.soldCards = new Set(soldCards); } }
        } catch (error) { console.error("Error fetching sold cards:", error); }
        gameState.cardsCache.ownedCardIndex = gameState.selectedCardIndex;
        const totalCards = 400; const fragment = document.createDocumentFragment();
        for (let i = 1; i <= totalCards; i++) {
            const cardElement = document.createElement("div"); cardElement.className = "card-item"; cardElement.innerHTML = i; cardElement.dataset.cardIndex = i;
            const isSold = gameState.cardsSold.has(i); const isOwned = gameState.selectedCardIndex === i;
            if (isOwned) { cardElement.classList.add("owned"); cardElement.onclick = () => handleCardSelection(i, cardElement); }
            else if (isSold) { cardElement.classList.add("sold"); cardElement.onclick = null; }
            else { cardElement.classList.add("available"); cardElement.onclick = () => handleCardSelection(i, cardElement); }
            if (gameState.uiSelectedCardIndex === i && !isOwned && !isSold) cardElement.classList.add("selected");
            gameState.cardsCache.cardElements[i] = cardElement; fragment.appendChild(cardElement);
        }
        grid.appendChild(fragment); gameState.cardsCache.lastUpdate = Date.now(); gameState.cardsLoaded = true;
    } catch (error) { console.error("Error loading cards grid:", error); } finally { gameState.isLoadingCards = false; }
}

async function handleCardSelection(cardIndex, element) {
    if (!validateGamePhase("card_purchase", "handleCardSelection")) return showNotification("Card purchase only during purchase phase", "error");
    if (gameState.isCardOperationInProgress) return;
    if (!gameState.gameId) { showNotification("No active game. Please wait...", "error"); await fetchActiveGame(); return; }
    if (!gameState.purchasePhaseActive) return showNotification("Card purchase is only available during card purchase phase", "error");
    if (gameState.selectedCardIndex === cardIndex) { await toggleCardPurchase(cardIndex, element, "refund"); return; }
    if (gameState.hasCard && gameState.selectedCardIndex !== cardIndex) {
        gameState.isCardOperationInProgress = true;
        try {
            const oldCardElement = gameState.cardsCache.cardElements[gameState.selectedCardIndex];
            if (oldCardElement) oldCardElement.classList.add("purchasing"); element.classList.add("purchasing");
            const refundResponse = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/toggle-card`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: gameState.userId, card_index: gameState.selectedCardIndex, action: "refund" }),
            });
            const refundData = await refundResponse.json();
            if (!refundData.success) throw new Error(refundData.message || "Failed to refund card");
            if (oldCardElement) instantCardUpdate(gameState.selectedCardIndex, "available");
            gameState.hasCard = false; gameState.selectedCardIndex = null; gameState.uiSelectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear();
            gameState.walletBalance = refundData.new_balance || gameState.walletBalance;
            if (refundData.prize_pool !== undefined) gameState.prizePool = refundData.prize_pool; updateGameStats(); document.getElementById("selected-card-info").style.display = "none";
            if (gameState.walletBalance < CARD_PRICE) { showNotification(`Insufficient balance. Need ${CARD_PRICE} birr`, "error"); if (oldCardElement) oldCardElement.classList.remove("purchasing"); element.classList.remove("purchasing"); gameState.isCardOperationInProgress = false; return; }
            const buyResponse = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/toggle-card`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: gameState.userId, card_index: cardIndex, action: "buy" }),
            });
            const buyData = await buyResponse.json();
            if (!buyData.success) throw new Error(buyData.message || "Failed to buy card");
            instantCardUpdate(cardIndex, "owned", { numbers: buyData.card_numbers, prize_pool: buyData.prize_pool, total_players: buyData.total_players, real_players: buyData.real_players, fake_players: buyData.fake_players, wallet_balance: buyData.new_balance });
            if (oldCardElement) oldCardElement.classList.remove("purchasing"); element.classList.remove("purchasing");
        } catch (error) { console.error("Error during card replacement:", error); showNotification(error.message || "Failed to replace card", "error"); if (oldCardElement) oldCardElement.classList.remove("purchasing"); element.classList.remove("purchasing"); } finally { gameState.isCardOperationInProgress = false; }
        return;
    }
    if (!gameState.hasCard) {
        if (gameState.cardsSold.has(cardIndex)) return showNotification("This card is already sold to another player", "error");
        if (gameState.walletBalance < CARD_PRICE) return showNotification(`Insufficient balance. Need ${CARD_PRICE} birr`, "error");
        if (gameState.uiSelectedCardIndex && gameState.uiSelectedCardIndex !== cardIndex) {
            const prevCard = gameState.cardsCache.cardElements[gameState.uiSelectedCardIndex];
            if (prevCard && !prevCard.classList.contains("owned") && !prevCard.classList.contains("sold")) prevCard.classList.remove("selected");
        }
        gameState.uiSelectedCardIndex = cardIndex; element.classList.add("selected");
        await toggleCardPurchase(cardIndex, element, "buy"); return;
    }
}
window.handleCardSelection = handleCardSelection;

async function toggleCardPurchase(cardIndex, element, action) {
    if (!validateGamePhase("card_purchase", "toggleCardPurchase")) { if (element) element.classList.remove("purchasing"); gameState.isCardOperationInProgress = false; return; }
    gameState.isCardOperationInProgress = true;
    if (!gameState.gameId) { showNotification("No active game. Please wait...", "error"); gameState.isCardOperationInProgress = false; await fetchActiveGame(); return; }
    if (!gameState.purchasePhaseActive) { showNotification("Card purchase is only available during card purchase phase", "error"); gameState.isCardOperationInProgress = false; return; }
    if (action === "buy" && gameState.hasCard) { showNotification("You already have a card. Click on another card to replace it.", "error"); gameState.isCardOperationInProgress = false; return; }
    if (action === "buy") { if (gameState.walletBalance < CARD_PRICE) { showNotification(`Insufficient balance. Need ${CARD_PRICE} birr`, "error"); gameState.isCardOperationInProgress = false; element.classList.remove("selected"); gameState.uiSelectedCardIndex = null; return; } }
    if (action === "refund" && (!gameState.hasCard || gameState.selectedCardIndex !== cardIndex)) { showNotification("You don't own this card to refund", "error"); gameState.isCardOperationInProgress = false; return; }
    try {
        if (element) element.classList.add("purchasing");
        const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/toggle-card`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: gameState.userId, card_index: cardIndex, action: action }),
        });
        const data = await response.json();
        if (data.success) {
            if (action === "buy") { instantCardUpdate(cardIndex, "owned", { numbers: data.card_numbers, prize_pool: data.prize_pool, total_players: data.total_players, real_players: data.real_players, fake_players: data.fake_players, wallet_balance: data.new_balance }); } 
            else if (action === "refund") { instantCardUpdate(cardIndex, "available"); gameState.hasCard = false; gameState.selectedCardIndex = null; gameState.selectedCardNumbers = []; gameState.markedNumbers.clear(); document.getElementById("selected-card-info").style.display = "none"; renderEmptyPlayerCard(); if (data.new_balance !== undefined) gameState.walletBalance = data.new_balance; }
            gameState.prizePool = data.prize_pool || gameState.prizePool; if (data.total_players !== undefined) gameState.totalPlayers = data.total_players; updateGameStats();
        } else { showNotification(data.message || "Failed to process card", "error"); if (element) element.classList.remove("purchasing"); element.classList.remove("selected"); gameState.uiSelectedCardIndex = null; }
    } catch (error) { console.error("Error toggling card:", error); showNotification("Failed to process card. Please try again.", "error"); if (element) element.classList.remove("purchasing"); element.classList.remove("selected"); gameState.uiSelectedCardIndex = null; } finally { gameState.isCardOperationInProgress = false; }
}
window.toggleCardPurchase = toggleCardPurchase;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startSyncInterval() { if (gameState.syncInterval) clearInterval(gameState.syncInterval); gameState.syncInterval = setInterval(() => { syncWithServer(); }, 2000); }

function forceSync() { syncWithServer(); console.log("Syncing with server..."); }
window.forceSync = forceSync;

async function fetchActiveGame() {
    try {
        const response = await fetch("/api/game/active");
        if (!response.ok) { if (response.status === 404) return null; throw new Error(`HTTP ${response.status}`); }
        const data = await response.json(); return data.success ? data : null;
    } catch (error) { console.error("Error fetching active game:", error); return null; }
}

async function getUserBalance() {
    try {
        const response = await fetch(`/api/user/balance/${gameState.userId}`);
        if (!response.ok) { gameState.walletBalance = 0.0; updateGameStats(); return; }
        const data = await response.json();
        gameState.walletBalance = data.success ? (parseFloat(data.balance) || 0.0) : 0.0;
        updateGameStats();
    } catch (error) { console.error("Error fetching balance:", error); gameState.walletBalance = 0.0; updateGameStats(); }
}

async function checkUserCardStatus() {
    try {
        if (!gameState.gameId) return;
        const response = await fetch(`${API_BASE_URL}/game/${gameState.gameId}/user-state/${gameState.userId}`);
        if (!response.ok) { if (response.status === 404) { gameState.hasCard = false; return; } throw new Error(`HTTP ${response.status}`); }
        const data = await response.json();
        if (data.success) {
            gameState.hasCard = data.has_card || false;
            if (data.has_card && data.user_card) {
                gameState.selectedCardId = data.user_card.card_id; gameState.selectedCardIndex = data.user_card.card_index;
                if (data.user_card.card_data) {
                    try {
                        let cardData = data.user_card.card_data; if (typeof cardData === "string") cardData = JSON.parse(cardData);
                        if (Array.isArray(cardData)) gameState.selectedCardNumbers = cardData; else if (cardData && typeof cardData === "object") { if (cardData.numbers && Array.isArray(cardData.numbers)) gameState.selectedCardNumbers = cardData.numbers; else if (cardData.grid && Array.isArray(cardData.grid)) { const flattened = []; for (const row of cardData.grid) { if (Array.isArray(row)) flattened.push(...row); } gameState.selectedCardNumbers = flattened; } else if (Array.isArray(cardData.cells)) gameState.selectedCardNumbers = cardData.cells.map((cell) => cell.number || cell); }
                    } catch (e) { console.error("Error parsing card data:", e); gameState.selectedCardNumbers = generateFallbackCardNumbers(); }
                } else gameState.selectedCardNumbers = generateFallbackCardNumbers();
                document.getElementById("selected-card-id").textContent = `#${data.user_card.card_index || "0"}`;
                document.getElementById("player-card-id").textContent = data.user_card.card_index || "0";
                if (gameState.gamePhase === "card_purchase") { showCardPreview(); document.getElementById("selected-card-info").style.display = "block"; gameState.cardsCache.ownedCardIndex = data.user_card.card_index; }
            }
            updateGameStats();
        } else console.warn("Failed to get user game state:", data.message);
    } catch (error) { console.error("Error checking user card status:", error); gameState.hasCard = false; }
}

function formatCurrency(amount) {
    const num = parseFloat(amount); return isNaN(num) ? "0.00 birr" : num.toFixed(2) + " birr";
}

// ==================== INITIALIZATION ====================
async function initGame() {
    console.log("Initializing haset Bingo (Server-Coordinated)...");
    updateConnectionStatus("Initializing...", "orange");
    gameState.userId = getUserId(); console.log("User ID:", gameState.userId);
    if (!gameState.audioInitialized) showAudioPrompt();
    await getUserBalance();
    if (gameState.walletBalance === undefined || gameState.walletBalance === null) { gameState.walletBalance = 0.0; updateGameStats(); }
    const gameData = await fetchActiveGame();
    if (gameData && gameData.success) {
        console.log("Active game found:", gameData.game_id);
        gameState.gameId = gameData.game_id; gameState.gameType = gameData.game_type || "round_based"; gameState.gameStatus = gameData.status || "unknown"; gameState.gamePhase = gameData.status || "card_purchase"; gameState.lastConfirmedPhase = gameData.status || "card_purchase";
        gameState.prizePool = parseFloat(gameData.prize_pool || 0); gameState.totalPlayers = gameData.total_players || 0; gameState.realPlayers = gameData.real_players || 0; gameState.fakePlayers = gameData.fake_players || 0; gameState.playerCount = gameData.total_players || 0; gameState.currentRound = gameData.round_number || 1;
        gameState.countdown = gameData.countdown_remaining || 30; gameState.countdownTotal = gameData.countdown_remaining || 30; gameState.calledNumbers = gameData.numbers_called || [];
        gameState.purchasePhaseActive = gameState.gamePhase === "card_purchase";
        console.log(`Initial countdown from server: ${gameState.countdown}s`);
        document.getElementById("current-round-number").textContent = gameState.currentRound;
        startServerCoordinatedCountdown();
        updateGameStats(); updateCalledNumbersDisplay(); updateCurrentCalledDisplay(); updateBingoGrid();
        if (!gameState.cardsLoaded && !gameState.cardsLoadAttempted) {
            gameState.cardsLoadAttempted = true;
            setTimeout(() => { if (document.getElementById("cards-grid").children.length === 0) { loadCardsGrid().then(() => { console.log("✅ Cards loaded at initialization"); }); } else { updateCardsGridInstant(); gameState.cardsLoaded = true; } }, 100);
        }
    } else { console.log("No active game found"); setTimeout(() => { initGame(); }, 5000); return; }
    await initWebSocket(); await checkUserCardStatus(); startSyncInterval();
    setInterval(() => { if (gameState.gameId && !gameState.fullSyncInProgress && !gameState.winnerAnnounced) getCompleteGameState(); }, 300000);
    updateConnectionStatus("Connected", "green"); updateGameUI();
    setInterval(() => { if (gameState.gameActive && gameState.hasCard) updateBingoButton(); }, 500);
}

// Final Initialization trigger
document.addEventListener("DOMContentLoaded", function () {
    // Standard bootstrap
    const isTelegram = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== "";
    if (!isTelegram) {
        document.getElementById("access-denied").style.display = "flex";
        return;
    }
    const tg = window.Telegram.WebApp; tg.expand();
    
    // Setup Audio toggle listener
    const audioToggle = document.getElementById("audio-toggle");
    if (audioToggle) {
        audioToggle.removeEventListener("click", toggleAudio);
        audioToggle.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); toggleAudio(); });
    }
    // Setup global click for audio init
    document.addEventListener("click", function initializeAudioOnClick() { if (!gameState.audioInitialized) initializeAudio(); document.removeEventListener("click", initializeAudioOnClick); });
    document.addEventListener("touchstart", function initializeAudioOnTouch() { if (!gameState.audioInitialized) initializeAudio(); document.removeEventListener("touchstart", initializeAudioOnTouch); });

    // Initialize the game
    initGame();
});