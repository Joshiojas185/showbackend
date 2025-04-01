const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['my-custom-header'],
        credentials: true
    }
});

app.use(cors());

let rooms = {}; // Store rooms dynamically

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomName, playerName) => {
        if (!rooms[roomName]) {
            rooms[roomName] = { players: [], raisedHands: [] }; // Initialize room if it doesn't exist
        }
        
        socket.join(roomName); // Join the room
        rooms[roomName].players.push({ id: socket.id, name: playerName }); // Add player to the room
        io.to(roomName).emit('updateHands', rooms[roomName].raisedHands.map(hand => hand.name)); // Update hands list
        io.to(roomName).emit('updatePlayers', rooms[roomName].players); // Update player list
    });

    socket.on('raiseHand', () => {
        const roomName = Object.keys(rooms).find(room => rooms[room].players.some(player => player.id === socket.id));
        const player = rooms[roomName].players.find(p => p.id === socket.id);
        if (player && !rooms[roomName].raisedHands.some(hand => hand.id === socket.id)) {
            rooms[roomName].raisedHands.push({ id: socket.id, name: player.name }); // Store both id and name
            io.to(roomName).emit('updateHands', rooms[roomName].raisedHands.map(hand => hand.name)); // Send only names
        }
    });

    socket.on('lowerHand', () => {
        const roomName = Object.keys(rooms).find(room => rooms[room].players.some(player => player.id === socket.id));
        const player = rooms[roomName].players.find(p => p.id === socket.id);
        if (player) {
            rooms[roomName].raisedHands = rooms[roomName].raisedHands.filter(hand => hand.id !== socket.id); // Remove by id
            io.to(roomName).emit('updateHands', rooms[roomName].raisedHands.map(hand => hand.name)); // Send only names
        }
    });

    socket.on('disconnect', () => {
        for (const roomName in rooms) {
            // Find the player in the room
            const playerIndex = rooms[roomName].players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const playerName = rooms[roomName].players[playerIndex].name; // Get the player's name

                // Remove the player from the players list
                rooms[roomName].players.splice(playerIndex, 1);

                // Remove the player's name from the raised hands list if they were raising their hand
                rooms[roomName].raisedHands = rooms[roomName].raisedHands.filter(hand => hand.id !== socket.id);

                // Emit updated lists to the room
                io.to(roomName).emit('updatePlayers', rooms[roomName].players);
                io.to(roomName).emit('updateHands', rooms[roomName].raisedHands.map(hand => hand.name)); // Send only names
                console.log('A user disconnected:', socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
// const HOST = '192.168.29.153';

server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});