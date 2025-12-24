// server.js - Backend Node.js Server Code (Verified)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CRITICAL: Ensure CORS is correct for the client's domain
const io = new Server(server, {
    cors: {
        // Client URL is set correctly here
        origin: "https://mhnofficial.github.io", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// ... (Rest of your game logic) ...

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    // ... Your connection logic is here ...
});

server.listen(PORT, () => {
    console.log(`UMG Multiplayer Server is running on port ${PORT}`);
});
