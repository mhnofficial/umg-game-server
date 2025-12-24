// server.js - Backend Node.js Server Code
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto'); // Used for generating unique IDs

const app = express();
const server = http.createServer(app);

// Use CORS to allow connections from the browser client
const io = new Server(server, {
    cors: {
        origin: "*", // ⚠️ In production, replace "*" with your game's domain
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
 * In a real game, this would load a map template based on size/rules.
 * @param {number} mapSize - The requested map size.
 * @returns {object} Initial territories state.
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
            ownerId: null, // Unclaimed initially
            militaryUnits: 0,
            productionValue: Math.floor(Math.random() * 500) + 100, // Random starting value
            coords: { x: Math.random() * 1000, y: Math.random() * 700 } // Placeholder
        };
    }
    return territories;
}

/**
 * Selects the next player in sequence to take the turn.
 * @param {object} game - The current game state.
 * @returns {string} The ID of the next player.
 */
function getNextPlayerId(game) {
    const playerIDs = Object.keys(game.players);
    if (playerIDs.length === 0) return null;

    if (!game.gameState.currentTurnPlayerId) {
        return playerIDs[0]; // Start with the host or first player
    }

    const currentIndex = playerIDs.indexOf(game.gameState.currentTurnPlayerId);
    const nextIndex = (currentIndex + 1) % playerIDs.length;
    return playerIDs[nextIndex];
}

/**
 * The CORE GAME LOGIC function. Validates, applies, and broadcasts the result of an action.
 * @param {object} game - The mutable game object.
 * @param {string} playerID - The ID of the player performing the action.
 * @param {object} action - The action data from the client.
 */
function processAction(game, playerID, action) {
    const player = game.players[playerID];
    const state = game.gameState;

    // 1. Turn Validation (Crucial for multiplayer)
    if (state.currentTurnPlayerId !== playerID) {
        // You can emit an error back to the player here
        io.to(playerID).emit('globalChat', 'ERROR: It is not your turn.', 'error');
        return; 
    }

    let broadcastMessage = null;

    switch (action.type) {
        case 'CLAIM_TERRITORY':
            const target = state.territories[action.territoryId];
            if (target && target.ownerId === null && player.resources.money >= 500) {
                target.ownerId = playerID;
                target.militaryUnits = 2; // Initial garrison
                player.resources.money -= 500;
                broadcastMessage = `${player.name} claimed ${target.name}.`;
            } else {
                 io.to(playerID).emit('globalChat', 'ERROR: Cannot claim territory (already owned or insufficient funds).', 'error');
            }
            break;

        case 'ATTACK_TERRITORY':
            // ⚠️ Complex logic placeholder ⚠️
            // 1. Check if attack is legal (neighbor, not too far, sufficient units).
            // 2. Perform combat calculation (dice roll/formula based on units).
            // 3. Update territory ownership and unit counts.
            broadcastMessage = `${player.name} declared war! (Combat result pending)`;
            break;

        case 'END_TURN':
            // Advance resources/income before ending turn
            // player.resources.money += calculateIncome(player, state.territories);

            // Determine the next player
            const nextPlayerId = getNextPlayerId(game);
            
            // If it's the host's turn again, advance the game turn count
            if (nextPlayerId === Object.keys(game.players)[0] && state.gamePhase === 'ACTIVE') {
                state.currentTurn++;
            }
            
            state.currentTurnPlayerId = nextPlayerId;
            broadcastMessage = `${player.name} ended their turn. It is now ${game.players[nextPlayerId]?.name}'s turn.`;
            break;
            
        default:
            console.log(`Unknown action type: ${action.type}`);
    }

    // Broadcast log message and updated state to all clients in the room
    if (broadcastMessage) {
        io.to(game.id).emit('globalChat', broadcastMessage, 'system');
    }
    
    // Send the authoritative state back to all players
    io.to(game.id).emit('stateUpdate', {
        currentTurn: state.currentTurn,
        gamePhase: state.gamePhase,
        currentTurnPlayerId: state.currentTurnPlayerId,
        territories: state.territories,
        // Player resources need to be updated selectively or included in state.players
        players: game.players 
    });
}

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // The player's assigned gameID is stored temporarily after they join a room
    let currentGameID = null;

    // [1] HANDLE SERVER LIST REQUEST
    socket.on('requestServerList', () => {
        const serverList = Object.values(GAMES).map(game => ({
            id: game.id,
            serverName: game.serverName,
            hostName: game.hostName,
            description: game.settings.description,
            maxPlayers: game.settings.maxPlayers,
            currentPlayers: Object.keys(game.players).length,
            hasPassword: !!game.password,
            gameSpeed: game.settings.gameSpeed,
        }));
        socket.emit('serverList', serverList);
    });

    // [2] HANDLE CREATE SERVER REQUEST
    socket.on('createServer', (data) => {
        const gameID = generateGameID();
        
        GAMES[gameID] = {
            id: gameID,
            serverName: data.serverName,
            hostName: data.hostName,
            password: data.password || null,
            settings: data, 
            players: {}, 
            gameState: {
                currentTurn: 1,
                gamePhase: 'SETUP',
                currentTurnPlayerId: null, // Assigned on first player join
                territories: createInitialMap(data.mapSize),
            }
        };
        console.log(`Created new server: ${gameID} - ${data.serverName}`);
    });

    // [3] HANDLE JOIN SERVER REQUEST
    socket.on('joinServer', ({ serverID, password }) => {
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
        const playerName = data.hostName || `Player ${playerCount + 1}`;
        
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
            serverID: serverID,
            resources: game.players[playerID].resources // Send individual player resources
        });
        
        // Update all players with the new player list
        io.to(serverID).emit('stateUpdate', { players: game.players });
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
            io.to(currentGameID).emit('globalChat', `${player.name}: ${message}`, 'chat');
        }
    });

    // [6] HANDLE DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const game = GAMES[currentGameID];
        if (game) {
            const playerName = game.players[socket.id]?.name || 'A player';
            delete game.players[socket.id];
            
            // Broadcast that a player left
            io.to(currentGameID).emit('globalChat', `${playerName} has disconnected.`, 'system');
            
            // Send updated player list
            io.to(currentGameID).emit('stateUpdate', { players: game.players });

            // TODO: If the game is empty, delete the server
            if (Object.keys(game.players).length === 0) {
                 delete GAMES[currentGameID];
                 console.log(`Server ${currentGameID} shut down due to player departure.`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
    
});