const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Game rooms state storage
const rooms = {};
let activeMatchRoom = null;

const MIN_PLAYERS_PER_ROOM = 2;
const MAX_PLAYERS_PER_ROOM = 5; // Updated to support up to 5 players
const COUNTDOWN_SECONDS = 15;

app.get("/", (req, res) => {
    res.send("Universal Indoor Game & Rummy Socket.IO Backend is Running!");
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        activeRooms: Object.keys(rooms).length
    });
});

function generateRoomCode() {
    let code;
    do {
        code = Math.random()
            .toString(36)
            .substring(2, 7)
            .toUpperCase();
    } while (rooms[code]);
    return code;
}

function getCleanRoomState(room) {
    return {
        id: room.id,
        gameName: room.gameName,
        maxRounds: room.maxRounds,
        currentRound: room.currentRound,
        status: room.status,
        started: room.started,
        timerVal: room.timerVal,
        gameData: room.gameData || "",
        players: room.players.map((p) => ({
            id: p.id,
            name: p.username || p.name,
            score: p.score,
            isHost: p.isHost
        }))
    };
}

io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // 1. Join Game / Auto-Matchmaking with custom configurations
    socket.on("joinGame", (playerData) => {
        let playerName = playerData && (playerData.username || playerData.name) ? (playerData.username || playerData.name) : `Player_${socket.id.substring(0, 4)}`;
        let gameName = playerData && playerData.gameName ? playerData.gameName : 'Generic Indoor Game';
        let maxRounds = playerData && playerData.maxRounds ? playerData.maxRounds : 3;
        let requestedRoomId = playerData && playerData.roomId ? playerData.roomId : null;

        let targetRoomCode = requestedRoomId;

        // If a specific room wasn't requested, use active match room logic
        if (!targetRoomCode) {
            if (
                !activeMatchRoom ||
                !rooms[activeMatchRoom] ||
                rooms[activeMatchRoom].players.length >= MAX_PLAYERS_PER_ROOM ||
                rooms[activeMatchRoom].status === 'playing' ||
                rooms[activeMatchRoom].status === 'finished'
            ) {
                activeMatchRoom = generateRoomCode();
            }
            targetRoomCode = activeMatchRoom;
        }

        let currentRoom = rooms[targetRoomCode];

        if (!currentRoom) {
            rooms[targetRoomCode] = {
                id: targetRoomCode,
                gameName: gameName,
                maxRounds: maxRounds,
                currentRound: 1,
                players: [],
                status: 'waiting', // waiting, playing, finished
                started: false,
                countdown: null,
                timerVal: COUNTDOWN_SECONDS,
                gameData: ""
            };
            currentRoom = rooms[targetRoomCode];
        }

        // Check player limits (Min 2, Max 5)
        if (currentRoom.players.length >= MAX_PLAYERS_PER_ROOM) {
            socket.emit('error_message', `Room is full! Maximum ${MAX_PLAYERS_PER_ROOM} players allowed.`);
            return;
        }

        if (currentRoom.status === 'playing' || currentRoom.status === 'finished') {
            socket.emit('error_message', 'Game has already started or finished.');
            return;
        }

        socket.join(targetRoomCode);
        socket.roomCode = targetRoomCode;

        // Check if player already exists in room
        const existingPlayerIndex = currentRoom.players.findIndex(p => p.id === socket.id);
        if (existingPlayerIndex === -1) {
            const player = {
                id: socket.id,
                username: playerName,
                name: playerName,
                score: 0,
                isHost: currentRoom.players.length === 0
            };
            currentRoom.players.push(player);
        }

        socket.emit("assignedRoom", targetRoomCode);
        io.to(targetRoomCode).emit("roomUpdate", getCleanRoomState(currentRoom));

        console.log(`${playerName} (${socket.id}) joined room ${targetRoomCode}. Total players: ${currentRoom.players.length}`);

        // Start countdown when minimum players are reached
        if (
            currentRoom.players.length >= MIN_PLAYERS_PER_ROOM &&
            !currentRoom.countdown &&
            currentRoom.status === 'waiting'
        ) {
            currentRoom.timerVal = COUNTDOWN_SECONDS;

            io.to(targetRoomCode).emit("countdownUpdate", currentRoom.timerVal);

            currentRoom.countdown = setInterval(() => {
                currentRoom.timerVal--;

                io.to(targetRoomCode).emit("countdownUpdate", currentRoom.timerVal);

                if (currentRoom.timerVal <= 0) {
                    clearInterval(currentRoom.countdown);
                    currentRoom.countdown = null;
                    currentRoom.status = 'playing';
                    currentRoom.started = true;

                    console.log(`Countdown finished for room ${targetRoomCode}. Starting game.`);

                    io.to(targetRoomCode).emit("game_started", {
                        message: `Game of ${currentRoom.gameName} has started!`,
                        currentRound: currentRoom.currentRound,
                        maxRounds: currentRoom.maxRounds
                    });

                    io.to(targetRoomCode).emit("gameStartSignal", getCleanRoomState(currentRoom));
                }
            }, 1000);
        }
    });

    // Alias for join_game if frontend uses snake_case
    socket.on("join_game", (data) => {
        socket.emit("joinGame", data);
    });

    // 2. Main unified state synchronization handler
    socket.on("syncGameState", (state) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        const room = rooms[roomCode];
        room.gameData = state.gameData || "";
        room.winnerName = state.winnerName || null;
        room.wrongShowPlayer = state.wrongShowPlayer || null;

        console.log(`Game state synced for room ${roomCode}`);

        io.to(roomCode).emit("gameStateUpdated", {
            gameData: room.gameData,
            winnerName: room.winnerName,
            wrongShowPlayer: room.wrongShowPlayer
        });
    });

    // 3. Submit Round Results / Scores & Round Progression
    socket.on("submit_round_score", ({ roomId, roundScores }) => {
        const roomCode = roomId || socket.roomCode;
        const room = rooms[roomCode];
        if (!room || room.status !== 'playing') return;

        // Update scores based on client submission: [{ id: 'socket_id', roundScore: 10 }, ...]
        if (roundScores && Array.isArray(roundScores)) {
            roundScores.forEach(update => {
                const player = room.players.find(p => p.id === update.id);
                if (player) {
                    player.score += (update.roundScore || 0);
                }
            });
        }

        if (room.currentRound < room.maxRounds) {
            room.currentRound++;
            io.to(roomCode).emit('round_ended', {
                round: room.currentRound - 1,
                message: `Round ${room.currentRound - 1} finished! Starting Round ${room.currentRound}.`,
                scoreboard: room.players
            });
        } else {
            // Game Over - Determine Winner across all rounds
            room.status = 'finished';
            
            // Sort players by highest score (Descending)
            room.players.sort((a, b) => b.score - a.score);
            const winner = room.players[0];

            io.to(roomCode).emit('game_over', {
                message: `🎉 Game Over! The winner is ${winner.username || winner.name} with ${winner.score} points!`,
                winner: winner,
                finalScoreboard: room.players
            });
        }
    });

    // 4. Broadcast valid declaration event explicitly (Rummy specific)
    socket.on("playerDeclared", (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        rooms[roomCode].winnerName = data.winnerName;
        console.log(`Player declared win in room ${roomCode}: ${data.winnerName}`);

        socket.to(roomCode).emit("playerDeclared", data);
    });

    // 5. Broadcast wrong show / invalid declaration event
    socket.on("playerWrongShow", (data) => {
        const roomCode = socket.roomCode;
        if (-!roomCode || !rooms[roomCode]) return;

        console.log(`Wrong show declared in room ${roomCode} by ${data.playerName}`);
        socket.to(roomCode).emit("playerWrongShow", data);
    });

    // 6. Handle player dropping out or folding
    socket.on("playerDropped", (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        console.log(`Player dropped in room ${roomCode}`);
        socket.to(roomCode).emit("playerDropped", data);
    });

    // 7. Handle Disconnections cleanly
    socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
        
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const removedPlayer = room.players.splice(playerIndex, 1)[0];
                
                // If room drops below minimum players during countdown, reset countdown
                if (room.players.length < MIN_PLAYERS_PER_ROOM && room.countdown) {
                    clearInterval(room.countdown);
                    room.countdown = null;
                    room.timerVal = COUNTDOWN_SECONDS;
                    io.to(roomCode).emit("countdownUpdate", COUNTDOWN_SECONDS);
                }

                if (room.players.length === 0) {
                    if (room.countdown) clearInterval(room.countdown);
                    delete rooms[roomCode];
                    if (activeMatchRoom === roomCode) activeMatchRoom = null;
                    console.log(`Room deleted: ${roomCode}`);
                } else {
                    // Reassign host if needed
                    if (!room.players.some((p) => p.isHost)) {
                        room.players[0].isHost = true;
                    }

                    io.to(roomCode).emit("roomUpdate", getCleanRoomState(room));
                    io.to(roomCode).emit("room_update", {
                        roomId: roomCode,
                        players: room.players,
                        message: `${removedPlayer.username || removedPlayer.name} left the game.`
                    });
                }
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Universal Game Server running on port ${PORT}`);
});