// Include Socket.io CDN in your HTML if not using npm:
// <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>

const SOCKET_SERVER_URL = ""; // 
const socket = io(SOCKET_SERVER_URL);

// --- 1. CONNECTION EVENTS ---
socket.on("connect", () => {
    console.log("Connected to game server with ID:", socket.id);
});

socket.on("connect_error", (err) => {
    console.error("Connection failed:", err.message);
});

// --- 2. JOIN GAME & MATCHMAKING ---
/**
 * Call this function when the player clicks "Join Game" or enters a room.
 * @param {string} username - Player's display name
 * @param {string} gameName - 'Rummy', 'Ludo', 'Chess', 'Carrom', etc.
 * @param {number} maxRounds - Total rounds to play (e.g., 3 or 5)
 * @param {string} [roomId] - Optional: specific room code if joining a friend's room
 */
function joinGameRoom(username, gameName = "Generic Indoor Game", maxRounds = 3, roomId = null) {
    socket.emit("joinGame", {
        username: username,
        gameName: gameName,
        maxRounds: maxRounds,
        roomId: roomId
    });
}

// Listen when successfully assigned to a room
socket.on("assignedRoom", (roomCode) => {
    console.log(`Successfully assigned to room: ${roomCode}`);
    // Update UI to show waiting room / room code
});

// Listen for updates on player list & room status
socket.on("roomUpdate", (roomState) => {
    console.log("Room State Updated:", roomState);
    // roomState contains: id, gameName, maxRounds, currentRound, status, started, players [{id, name, score, isHost}]
    // TODO: Update your UI player list here (Min 2 required)
});

// Listen for the 15-second countdown when room is full (min 2 players)
socket.on("countdownUpdate", (secondsLeft) => {
    console.log(`Game starting in ${secondsLeft} seconds...`);
    // TODO: Display countdown timer on UI
});

// Listen for the game start signal
socket.on("gameStartSignal", (roomState) => {
    console.log("Game has officially started!");
    // TODO: Transition UI from lobby to the game board screen
});

socket.on("game_started", (data) => {
    alert(data.message); // Notification popup
});


// --- 3. REAL-TIME GAME STATE SYNC (For Chess, Ludo, Carrom, etc.) ---
/**
 * Send board movements, dice rolls, or turn data to other players in the room.
 * @param {Object} updatedGameData - Game specific state (e.g., board positions, current turn)
 */
function sendGameStateUpdate(updatedGameData) {
    socket.emit("syncGameState", {
        gameData: updatedGameData
    });
}

// Receive state updates from opponent(s)
socket.on("gameStateUpdated", (data) => {
    console.log("Received Game State Update:", data);
    // data.gameData, data.winnerName, data.wrongShowPlayer
    // TODO: Redraw board or update game view based on incoming gameData
});


// --- 4. RUMMY & CARD GAME SPECIFIC EVENTS ---
function declareWin(winnerName) {
    socket.emit("playerDeclared", { winnerName });
}

function declareWrongShow(playerName) {
    socket.emit("playerWrongShow", { playerName });
}

function dropOut(playerName) {
    socket.emit("playerDropped", { playerName });
}

socket.on("playerDeclared", (data) => {
    alert(`${data.winnerName} has declared valid show!`);
});

socket.on("playerWrongShow", (data) => {
    alert(`${data.playerName} made a Wrong Show! Penalty applied.`);
});

socket.on("playerDropped", (data) => {
    console.log("A player folded or dropped out.");
});


// --- 5. ROUND SCORING & FINAL WINNER NOTIFICATIONS ---
/**
 * Submit scores at the end of a round.
 * @param {string} roomId - Current room ID
 * @param {Array} roundScores - [{ id: 'socket_id_1', roundScore: 10 }, { id: 'socket_id_2', roundScore: 5 }]
 */
function submitRoundScores(roomId, roundScores) {
    socket.emit("submit_round_score", {
        roomId: roomId,
        roundScores: roundScores
    });
}

// Triggered when a round finishes before max rounds are reached
socket.on("round_ended", (data) => {
    console.log(data.message); // e.g., "Round 1 finished! Starting Round 2."
    console.table(data.scoreboard); // View all players' accumulated scores so far
    // TODO: Show round results popup / notification toast
});

// Triggered when all rounds are completed (Game Over)
socket.on("game_over", (data) => {
    console.log(data.message); // 🎉 Game Over! Winner announcement
    console.log("Winner Details:", data.winner);
    console.table(data.finalScoreboard); // Detailed final scores for all participants
    
    // TODO: Display Victory/Defeat screen and final score details table
    alert(data.message);
});


// --- 6. ERROR HANDLING ---
socket.on("error_message", (errorMessage) => {
    alert(`Error: ${errorMessage}`);
});