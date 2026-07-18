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

// ... (Include all your original functions: showAudioPrompt, preloadAudioFiles, playNumberAudio, playWinnerSound, toggleAudio, updateAudioToggle, getBingoLetter, updateFakeCardsImmediately, updateConnectionStatus, claimBingo, checkForBingo, updateBingoButton, handleServerNumberCalled, updateCurrentCalledDisplay, handlePlayerCardClick, getUserId, fetchUserCardForGame, generateFallbackCardNumbers, sendWebSocketMessage, initWebSocket, instantCardUpdate, resetCardsForNewRound, getCompleteGameState, updateGameStats, startServerCoordinatedCountdown, handleWebSocketMessage, handleWinnerConfirmed, showWinnerAnnouncementScreen, startWinnerDisplayCountdown, handleWinnerDisplayCompleted, handleNewRoundStarted, handleBingoClaimVerified, handleBingoRejected, handleExistingGameResumed, handlePhaseChangeConfirmed, handleCriticalGameUpdate, updateFromServerState, syncWithServer, showScreen, showCardSelection, updateGameUI, updateCountdownDisplay, updateCountdownStatusText, updateBingoGrid, showCardPreview, renderPlayerCard, renderEmptyPlayerCard, updateCalledNumbersDisplay, updateCardsGridInstant, loadCardsGrid, handleCardSelection, toggleCardPurchase, sleep, startSyncInterval, forceSync, fetchActiveGame, getUserBalance, checkUserCardStatus, formatCurrency, initGame, etc.) 
// **Note:** To keep this response concise, I have cut the main function bodies here, but you must copy your exact `function` logic from your original HTML into this file.

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