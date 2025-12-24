// server.js - Backend Node.js Server Code

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// NOTE: This line is often helpful for debugging, but not necessary for Socket.IO
// app.get('/', (req, res) => {
//     res.send('Server is running, but I only speak Socket.IO');
// });


// CRITICAL: Ensure CORS is correct
const io = new Server(server, {
    cors: {
        // Explicitly set to your client's exact domain
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
