// server.js - Backend Node.js Server Code
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto'); // Used for generating unique IDs

const app = express();
const server = http.createServer(app);

// Use CORS to allow connections from the browser client (GitHub Pages URL)
const io = new Server(server, {
    cors: {
        // This MUST match the protocol and domain of your GitHub Pages client
        origin: "https://mhnofficial.github.io/umg-client-static", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- AUTHORITATIVE GAME STATE ---
const GAMES = {}; // Master object to hold all active game rooms

/**
 * Generates a unique, short, human-readable ID.
 * @returns {string} A unique game ID.
 */
function generateGameID() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); 
}

/**
 * Creates a basic, placeholder map for a new game.
 */
function createInitialMap(mapSize) {
    const territories = {};
    const count = mapSize === 'small' ? 50 : 
                  mapSize === 'medium' ? 100 : 
                  mapSize === 'large' ? 150 : 100;

    for (let i = 1; i <= count; i++) {
        territories[`T-${i}`] = {
            id: `T-${i}`,
            name: `Sector ${i}`,
            ownerId: null, 
            militaryUnits: 0,
            productionValue: Math.floor(Math.random() * 500) + 100, 
            coords: { x: Math.random() * 1000, y: Math.random() * 700 } 
        };
    }
    return territories;
}

/**
 * Selects the next player in sequence to take the turn.
 */
function getNextPlayerId(game) {
    const playerIDs = Object.keys(game.players);
    if (playerIDs.length === 0) return null;

    if (!game.gameState.currentTurnPlayerId) {
        return playerIDs[0]; 
    }

    const currentIndex = playerIDs.indexOf(game.gameState.currentTurnPlayerId);
    const nextIndex = (currentIndex + 1) % playerIDs.length;
    return playerIDs[nextIndex];
}

/**
 * The CORE GAME LOGIC function.
 */
function processAction(game, playerID, action) {
    const player = game.players[playerID];
    const state = game.gameState;

    // 1. Turn Validation
    if (state.currentTurnPlayerId !== playerID) {
        io.to(playerID).emit('globalChat', 'ERROR: It is not your turn.', 'error');
        return; 
    }

    let broadcastMessage = null;

    switch (action.type) {
        case 'CLAIM_TERRITORY':
             // ... your existing CLAIM_TERRITORY logic ...
             break;

        case 'ATTACK_TERRITORY':
             // ... your existing ATTACK_TERRITORY logic ...
             break;

        case 'END_TURN':
            const nextPlayerId = getNextPlayerId(game);
            
            if (nextPlayerId === Object.keys(game.players)[0] && state.gamePhase === 'ACTIVE') {
                state.currentTurn++;
            }
            
            state.currentTurnPlayerId = nextPlayerId;
            broadcastMessage = `${player.name} ended their turn. It is now ${game.players[nextPlayerId]?.name}'s turn.`;
            break;
            
        default:
            console.log(`Unknown action type: ${action.type}`);
    }

    if (broadcastMessage) {
        io.to(game.id).emit('globalChat', broadcastMessage, 'system');
    }
    
    // Send the authoritative state back to all players
    io.to(game.id).emit('stateUpdate', {
        currentTurn: state.currentTurn,
        gamePhase: state.gamePhase,
        currentTurnPlayerId: state.currentTurnPlayerId,
        territories: state.territories,
        players: game.players 
    });
}

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    let currentGameID = null;

    // [1] HANDLE SERVER LIST REQUEST
    socket.on('requestServerList', () => {
         // ... your existing requestServerList logic ...
    });

    // [2] HANDLE CREATE SERVER REQUEST
    socket.on('createServer', (data) => {
         // ... your existing createServer logic ...
    });

    // [3] HANDLE JOIN SERVER REQUEST - Client side must call this!
    socket.on('joinServer', ({ serverID, password, hostName }) => {
        const game = GAMES[serverID];
        if (!game) {
            socket.emit('joinFailed', 'Server not found.');
            return;
        }

        if (game.password && game.password !== password) {
            socket.emit('joinFailed', 'Incorrect password.');
            return;
        }

        if (Object.keys(game.players).length >= game.settings.maxPlayers) {
              socket.emit('joinFailed', 'Server is full.');
              return;
        }

        // --- SUCCESSFUL JOIN LOGIC ---
        socket.join(serverID);
        currentGameID = serverID;
        const playerID = socket.id; 
        
        // Add player to game state
        const playerCount = Object.keys(game.players).length;
        const playerName = hostName || `Player ${playerCount + 1}`; // Use hostName from client join data
        
        game.players[playerID] = { 
            id: playerID, 
            name: playerName, 
            color: '#' + Math.floor(Math.random()*16777215).toString(16), 
            isReady: false,
            resources: { money: game.settings.startingMoney, military: game.settings.startingMilitary, production: 0, research: 0 }
        };

        // Assign the first player to the current turn if it's the start of the game
        if (game.gameState.currentTurnPlayerId === null) {
            game.gameState.currentTurnPlayerId = playerID;
            game.gameState.gamePhase = 'ACTIVE';
        }
        
        // Broadcast that a new player joined
        io.to(serverID).emit('globalChat', `${playerName} has joined the game.`);
        
        // Send the complete, current state to the new player
        socket.emit('initialState', {
            ...game.gameState,
            playerID: playerID,
            players: game.players,
            server: { // Provide structured server info for client
                serverName: game.serverName,
                hostName: game.hostName,
                gameSpeed: game.settings.gameSpeed,
                maxPlayers: game.settings.maxPlayers,
                currentPlayers: Object.keys(game.players).length
            },
            player: { // Provide structured player info for client
                 name: playerName,
                 resources: game.players[playerID].resources
            }
        });
        
        // Update all players with the new player list
        io.to(serverID).emit('stateUpdate', { 
            players: game.players,
            currentDay: game.gameState.currentTurn // Send the day count in updates
        });
    });

    // [4] HANDLE PLAYER ACTIONS
    socket.on('playerAction', (action) => {
        const game = GAMES[currentGameID];
        if (game) {
            processAction(game, socket.id, action);
        }
    });

    // [5] HANDLE CHAT MESSAGES
    socket.on('chatMessage', (message) => {
        const game = GAMES[currentGameID];
        const player = game?.players[socket.id];
        if (player) {
            io.to(currentGameID).emit('globalChat', message, 'chat'); // Changed to only send message, author is added on client
        }
    });

    // [6] HANDLE DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const game = GAMES[currentGameID];
        if (game) {
             // ... your existing disconnect logic ...
        }
    });
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
    
});
