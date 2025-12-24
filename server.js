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
        // Setting origin to '*' is usually okay for development/simple deployment
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- AUTHORITATIVE GAME STATE ---
const GAMES = {}; // Master object to hold all active game rooms

// --- CONSTANTS ---
const BASE_CLAIM_COST = 500;
const UNIT_COST = 100;

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
 * Calculates and applies turn income and production.
 */
function applyTurnEndEffects(game) {
    const state = game.gameState;
    const players = game.players;

    // 1. Calculate Income and Maintenance
    Object.keys(players).forEach(pId => {
        let player = players[pId];
        let totalIncome = player.resources.research + player.resources.production;
        let maintenanceCost = Object.values(state.territories).filter(t => t.ownerId === pId).length * 10; // Small maintenance
        
        player.resources.money += totalIncome;
        player.resources.money -= maintenanceCost;
    });

    // 2. Resource/Production checks (simplified for now)
    // Future: Check for completed buildings/units
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
 * The CORE GAME LOGIC function. Handles all player actions.
 * 
 */
function processAction(game, playerID, action) {
    const player = game.players[playerID];
    const state = game.gameState;
    const socket = io.sockets.sockets.get(playerID); // Get the player's socket

    // 1. Turn Validation (Only allow action if it's the player's turn)
    if (state.currentTurnPlayerId !== playerID && action.type !== 'DISCONNECT') {
        socket.emit('globalChat', 'ERROR: It is not your turn to act.', 'error');
        return; 
    }

    let broadcastMessage = null;

    switch (action.type) {
        case 'CLAIM_TERRITORY':
            const terrClaim = state.territories[action.territoryId];
            if (!terrClaim) {
                socket.emit('globalChat', 'ERROR: Territory not found.', 'error');
                return;
            }
            if (terrClaim.ownerId !== null) {
                socket.emit('globalChat', 'ERROR: Territory is already claimed.', 'error');
                return;
            }
            if (player.resources.money < BASE_CLAIM_COST) {
                socket.emit('globalChat', `ERROR: Not enough money! Requires $${BASE_CLAIM_COST}.`, 'error');
                return;
            }

            // Execute Claim
            player.resources.money -= BASE_CLAIM_COST;
            terrClaim.ownerId = playerID;
            terrClaim.militaryUnits = 1; // Start with one unit
            
            // Update player production based on the new territory
            player.resources.production += terrClaim.productionValue; 
            
            broadcastMessage = `${player.name} claimed ${terrClaim.name} for $${BASE_CLAIM_COST}.`;
            break;

        case 'ATTACK_TERRITORY':
            // Placeholder: Implement dice rolling and combat resolution here
            broadcastMessage = `${player.name} attempted to attack a territory (Action Received).`;
            break;
            
        case 'EXPAND_LAND':
            // Client side should specify target, but for simplicity, we treat this as a generic claim attempt
            // Find a random UNCLAIMED territory to claim
            const unclaimed = Object.values(state.territories).filter(t => t.ownerId === null);
            if (unclaimed.length === 0) {
                 socket.emit('globalChat', 'ERROR: No unclaimed land left to expand into!', 'error');
                 return;
            }
            
            const targetTerritory = unclaimed[Math.floor(Math.random() * unclaimed.length)];
            
            if (player.resources.money < BASE_CLAIM_COST) {
                socket.emit('globalChat', `ERROR: Expansion requires $${BASE_CLAIM_COST}.`, 'error');
                return;
            }
            
            // Execute Expansion (same as claim for now)
            player.resources.money -= BASE_CLAIM_COST;
            targetTerritory.ownerId = playerID;
            targetTerritory.militaryUnits = 1; 
            player.resources.production += targetTerritory.productionValue;
            
            broadcastMessage = `${player.name} successfully expanded into ${targetTerritory.name}.`;
            break;
            
        case 'BUILD_UNIT':
            // For simplicity, build in a random owned territory
            const ownedTerritories = Object.values(state.territories).filter(t => t.ownerId === playerID);
            if (ownedTerritories.length === 0) {
                 socket.emit('globalChat', 'ERROR: You must own a territory to build units.', 'error');
                 return;
            }
            
            if (player.resources.money < UNIT_COST) {
                 socket.emit('globalChat', `ERROR: Building a unit requires $${UNIT_COST}.`, 'error');
                 return;
            }
            
            const buildTarget = ownedTerritories[Math.floor(Math.random() * ownedTerritories.length)];
            player.resources.money -= UNIT_COST;
            buildTarget.militaryUnits += 1;
            
            broadcastMessage = `${player.name} built a new unit in ${buildTarget.name}.`;
            break;
            
        case 'PROPOSE_TRUCE':
            const targetPlayer = game.players[action.targetId];
            if (!targetPlayer) {
                 socket.emit('globalChat', 'ERROR: Target player not found.', 'error');
                 return;
            }
            
            // Emit a specific "Truce Proposal" event to the target player
            io.to(action.targetId).emit('truceProposal', {
                fromPlayer: player.name,
                duration: action.duration,
                terms: action.terms,
                proposerId: playerID
            });
            
            broadcastMessage = `${player.name} sent a private truce proposal to ${targetPlayer.name}.`;
            break;
            
        // Placeholder handlers for future feature completion:
        case 'RESEARCH': // Placeholder for 'Invent'
        case 'CREATE_BUILDING': // Placeholder for 'Create' (building)
        case 'UPGRADE_TERRITORY': // Placeholder for 'Upgrade'
        case 'START_TASK': // Placeholder for 'Tasks'
        case 'PROPOSE_ALLY': // Placeholder for 'Ally'
        case 'PROPOSE_TRADE': // Placeholder for 'Trade'
            socket.emit('globalChat', `Action ${action.type} received. Server processing...`, 'system');
            // Logic for these actions would typically involve:
            // 1. Resource check (money, research points)
            // 2. Updating player stats (e.g., research level)
            // 3. Setting a turn-based completion timer (e.g., building takes 3 turns)
            break;

        case 'END_TURN':
            // 1. Apply end-of-turn effects for the player who just finished
            applyTurnEndEffects(game);
            
            // 2. Advance the turn and player
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
        const serverList = Object.values(GAMES).map(game => ({
            id: game.id,
            serverName: game.serverName,
            hostName: game.hostName,
            currentPlayers: Object.keys(game.players).length,
            maxPlayers: game.settings.maxPlayers,
            hasPassword: !!game.password,
            gamePhase: game.gameState.gamePhase
        }));
        socket.emit('serverList', serverList);
    });

    // [2] HANDLE CREATE SERVER REQUEST
    socket.on('createServer', (data) => {
        const newID = generateGameID();
        const settings = {
            gameSpeed: 'Standard',
            mapSize: 'medium',
            maxPlayers: 8,
            startingMoney: 5000,
            startingMilitary: 20,
            ...data.settings // Allow client to override defaults
        };
        
        GAMES[newID] = {
            id: newID,
            serverName: data.serverName || `Game ${newID}`,
            hostName: data.hostName || 'Host',
            password: data.password || null,
            settings: settings,
            players: {},
            gameState: {
                gamePhase: 'LOBBY',
                currentTurn: 1,
                currentTurnPlayerId: null,
                territories: createInitialMap(settings.mapSize),
                diplomacy: {} // Store truce/ally agreements
            }
        };

        socket.emit('serverCreated', newID);
        console.log(`Server created with ID: ${newID} by ${data.hostName}`);
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
        io.to(serverID).emit('globalChat', `${playerName} has joined the game.`, 'system');
        
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
            currentTurn: game.gameState.currentTurn // Send the day count in updates
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
            // Include the player's name and color for the client to render properly
            io.to(currentGameID).emit('globalChat', `${player.name}: ${message}`, 'chat'); 
        }
    });

    // [6] HANDLE DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const game = GAMES[currentGameID];
        if (game) {
            const player = game.players[socket.id];
            if (player) {
                // If the disconnected player was the current turn player, pass the turn
                if (game.gameState.currentTurnPlayerId === socket.id) {
                    processAction(game, socket.id, { type: 'END_TURN' });
                }
                
                delete game.players[socket.id];
                io.to(currentGameID).emit('globalChat', `${player.name} has left the game.`, 'system');
                
                // If no players remain, clean up the game room
                if (Object.keys(game.players).length === 0) {
                    delete GAMES[currentGameID];
                    console.log(`Game room ${currentGameID} deleted.`);
                } else {
                    // Update all remaining players
                    io.to(currentGameID).emit('stateUpdate', { players: game.players });
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
    
});
