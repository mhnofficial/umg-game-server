// server.js - Backend Node.js Server Code

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- Global Server State Management ---
const games = {}; // Stores all active game rooms: { serverID: { serverData, players: { playerID: playerData } } }
const playerToServer = {}; // Tracks which server each socket ID belongs to: { socketID: serverID }
const MAX_PLAYERS = 8;
// --------------------------------------

// Function to generate a simple, short, unique ID (e.g., 6-character alphanumeric)
function generateServerID() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// CRITICAL: Ensure CORS is correct for the client's domain
const io = new Server(server, {
    cors: {
        // Your GitHub Pages client URL
        origin: "https://mhnofficial.github.io", 
        methods: ["GET", "POST"]
    },
    // Allows the client's 'polling' transport to work with the server
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// --- UTILITY FUNCTIONS ---

// Function to broadcast the latest state of a specific game room
function broadcastGameState(serverID) {
    const game = games[serverID];
    if (!game) return;

    // We send a stripped-down version to keep the state update size small
    const stateToSend = {
        serverData: game.serverData,
        players: Object.values(game.players).map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isTurn: p.isTurn,
            // Only include basic, public player info
        }))
    };
    
    // Broadcast stateUpdate to everyone in the room except the sender
    io.to(serverID).emit('stateUpdate', stateToSend);
}

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // ===================================
    // 1. CREATE SERVER EVENT
    // ===================================
    socket.on('createServer', (data) => {
        const serverID = generateServerID();
        const playerID = socket.id;

        // Initialize the new game room
        games[serverID] = {
            serverData: {
                id: serverID,
                serverName: data.serverName || `Game by ${data.hostName}`,
                hostID: playerID,
                hostName: data.hostName,
                maxPlayers: MAX_PLAYERS,
                currentPlayers: 1,
                gameSpeed: data.gameSpeed || 'Standard',
                turn: 1,
                mapData: {} // Placeholder for map/game-specific data
            },
            players: {
                [playerID]: {
                    id: playerID,
                    name: data.hostName,
                    score: 0,
                    isTurn: true // Host goes first
                }
            }
        };

        // Join the new room and map the player to the server
        socket.join(serverID);
        playerToServer[playerID] = serverID;

        console.log(`Server created: ${serverID} by ${data.hostName}`);
        
        // Tell the client to redirect to the new game room URL
        socket.emit('serverCreated', serverID); 
        
        // Log the event to the console (not critical, but helpful)
        console.log(`New Server created: ${serverID}`);
    });


    // ===================================
    // 2. JOIN SERVER EVENT
    // ===================================
    socket.on('joinServer', (data) => {
        const serverID = data.serverID;
        const game = games[serverID];
        const playerID = socket.id;

        if (!game) {
            socket.emit('joinFailed', 'Server ID not found.');
            return;
        }

        if (game.serverData.currentPlayers >= game.serverData.maxPlayers) {
            socket.emit('joinFailed', 'Server is full.');
            return;
        }

        // Add player to the game state
        game.serverData.currentPlayers++;
        game.players[playerID] = {
            id: playerID,
            name: data.hostName, // Note: This should be user's name, not host name
            score: 0,
            isTurn: false // New players wait for their turn
        };

        // Join the room and map the player to the server
        socket.join(serverID);
        playerToServer[playerID] = serverID;

        // Send the complete initial state to the newly joined player
        socket.emit('initialState', { 
            playerID: playerID, 
            ...game 
        });

        // Announce the new player to the room
        io.to(serverID).emit('globalChat', `${data.hostName} has joined the game.`, 'system');

        // Broadcast the updated state (player list, count) to everyone
        broadcastGameState(serverID);
        console.log(`Player ${data.hostName} joined server: ${serverID}`);
    });
    
    
    // ===================================
    // 3. PLAYER ACTION EVENT
    // ===================================
    socket.on('playerAction', (action) => {
        const serverID = playerToServer[socket.id];
        const game = games[serverID];
        const player = game.players[socket.id];

        if (!game || !player) return; // Ignore if not in a game

        if (action.type === 'END_TURN' && player.isTurn) {
            // Logic to process the end of the turn
            // For now, just advance the turn and rotate who is turn
            player.isTurn = false;
            game.serverData.turn++;

            const playerIDs = Object.keys(game.players);
            const currentIndex = playerIDs.findIndex(id => id === socket.id);
            const nextIndex = (currentIndex + 1) % playerIDs.length;
            const nextPlayerID = playerIDs[nextIndex];

            // Set the next player's turn to true
            game.players[nextPlayerID].isTurn = true;

            // Announce the turn change
            io.to(serverID).emit('globalChat', `It is now ${game.players[nextPlayerID].name}'s turn (Day ${game.serverData.turn}).`, 'system');
            
            // Re-broadcast the state to update all client UIs
            broadcastGameState(serverID);
        }
        
        // Handle other actions (PROPOSE_TRUCE, EXPAND_LAND, etc.) here...
    });
    
    // ===================================
    // 4. CHAT MESSAGE
    // ===================================
    socket.on('chatMessage', (message) => {
        const serverID = playerToServer[socket.id];
        const game = games[serverID];
        const player = game.players[socket.id];
        
        if (!game || !player) return;

        // Broadcast the message to all players in the room
        io.to(serverID).emit('globalChat', `${player.name}: ${message}`, 'chat');
    });

    // ===================================
    // 5. DISCONNECT EVENT
    // ===================================
    socket.on('disconnect', () => {
        const playerID = socket.id;
        const serverID = playerToServer[playerID];

        if (serverID && games[serverID]) {
            const game = games[serverID];
            const playerName = game.players[playerID]?.name || 'A player';

            // Remove player from the game state
            delete game.players[playerID];
            game.serverData.currentPlayers--;
            delete playerToServer[playerID];
            
            // Announce the player departure
            io.to(serverID).emit('globalChat', `${playerName} has left the game.`, 'system');

            if (game.serverData.currentPlayers === 0) {
                // Last player left, delete the game room
                delete games[serverID];
                console.log(`Server closed: ${serverID} (last player left)`);
            } else {
                // If the host leaves, assign a new host (simple logic: first remaining player)
                if (game.serverData.hostID === playerID) {
                    const newHostID = Object.keys(game.players)[0];
                    if (newHostID) {
                        game.serverData.hostID = newHostID;
                        game.serverData.hostName = game.players[newHostID].name;
                        io.to(serverID).emit('globalChat', `${game.serverData.hostName} is the new host.`, 'system');
                    }
                }
                // Broadcast the updated state (removed player, potentially new host)
                broadcastGameState(serverID);
            }
        }
        console.log(`Player disconnected: ${playerID}`);
    });
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
});
