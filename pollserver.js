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

let rooms = {};

app.use(cors());
app.use(express.static('poll'));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomName, playerName) => {
        if (rooms[roomName] && !rooms[roomName].isAvailable) {
            io.to(socket.id).emit('roomNotAvailable', { message: "Thank you for joining the quiz! You will be redirected shortly.", image: 'thank-you.png' });
            return; 
        }
    
        socket.join(roomName);
        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: [],
                hosts: [],
                quizQuestions: [],
                currentQuestionIndex: 0,
                quizStarted: false,
                votes: [],
                currentQuestionTime: 15,
                timerInterval: null,
                timerPerQuestion: 15,
                votingAllowed: false,
                isAvailable: true 
            };
        }
    
        rooms[roomName].players.push({ id: socket.id, name: playerName });
        rooms[roomName].hosts.push(socket.id); // Allow everyone to be a host

        io.to(roomName).emit('updatePlayers', rooms[roomName].players);
        
        if (rooms[roomName].quizStarted) {
            const currentQuestion = rooms[roomName].quizQuestions[rooms[roomName].currentQuestionIndex];
            io.to(socket.id).emit('quizStarted', currentQuestion);
        }
    });

    socket.on('lockQuiz', (roomName) => {
        rooms[roomName].isAvailable = false;
        io.to(roomName).emit('quizLocked', { message: "Thank you for joining the quiz! You will be redirected shortly.", image: 'thank-you.png' });
    });

    socket.on('uploadQuiz', (roomName, quizJson, timerPerQuestion) => {
        if (rooms[roomName].hosts.includes(socket.id)) {
            try {
                const quizData = JSON.parse(quizJson);
                rooms[roomName].quizQuestions = quizData.questions;
                rooms[roomName].votes = rooms[roomName].quizQuestions.map(question => {
                    const optionCount = question.options.length;
                    return Array(optionCount).fill(0);
                });
                rooms[roomName].timerPerQuestion = timerPerQuestion;
                io.to(roomName).emit('quizUploaded', rooms[roomName].quizQuestions.length);
            } catch (err) {
                console.error('Invalid JSON format:', err);
                io.to(roomName).emit('uploadError', 'Invalid JSON format. Please check your file.');
            }
        } else {
            io.to(socket.id).emit('uploadError', 'You are not authorized to upload a quiz.');
        }
    });

    socket.on('startQuiz', (roomName) => {
        if (rooms[roomName].hosts.includes(socket.id) && rooms[roomName].quizQuestions.length > 0) {
            rooms[roomName].quizStarted = true;
            rooms[roomName].currentQuestionIndex = 0;
            io.to(roomName).emit('quizStarted', rooms[roomName].quizQuestions[rooms[roomName].currentQuestionIndex]);
            startTimer(roomName, rooms[roomName].timerPerQuestion);
        } else {
            io.to(socket.id).emit('startError', 'You are not authorized to start the quiz or there are no questions.');
        }
    });

    function startTimer(roomName, duration) {
        if (!rooms[roomName]) {
            console.error(`Room ${roomName} does not exist. Cannot start timer.`);
            return;
        }
    
        let timeLeft = duration;
        rooms[roomName].votingAllowed = true;
        rooms[roomName].timerInterval = setInterval(() => {
            if (timeLeft <= 0) {
                clearInterval(rooms[roomName].timerInterval);
                rooms[roomName].votingAllowed = false;
                io.to(roomName).emit('showPoll', rooms[roomName].votes[rooms[roomName].currentQuestionIndex]);
                io.to(roomName).emit('timerEnded');
            } else {
                io.to(roomName).emit('updateTimer', timeLeft);
                timeLeft--;
            }
        }, 1000);
    }

    socket.on('vote', (roomName, option) => {
        const currentQuestionIndex = rooms[roomName].currentQuestionIndex;
        const optionIndex = option.charCodeAt(0) - 65;
        
        if (rooms[roomName].quizStarted && rooms[roomName].votingAllowed && rooms[roomName].votes[currentQuestionIndex][optionIndex] !== undefined) {
            rooms[roomName].votes[currentQuestionIndex][optionIndex]++;
            io.to(roomName).emit('updateVotes', rooms[roomName].votes[currentQuestionIndex]);
        }
    });
         
    socket.on('sendEmoji', (roomName, emoji, position) => {
        io.to(roomName).emit('receiveEmoji', emoji, position);
    });
    
    socket.on('nextQuestion', (roomName) => {
        if (rooms[roomName].hosts.includes(socket.id) && rooms[roomName].currentQuestionIndex < rooms[roomName].quizQuestions.length - 1) {
            rooms[roomName].currentQuestionIndex++;
            clearInterval(rooms[roomName].timerInterval);
            io.to(roomName).emit('nextQuestion', rooms[roomName].quizQuestions[rooms[roomName].currentQuestionIndex]);
            startTimer(roomName, rooms[roomName].timerPerQuestion);
        } else if (rooms[roomName].currentQuestionIndex === rooms[roomName].quizQuestions.length - 1) {
            io.to(roomName).emit('quizEnded');
        }
    });

    socket.on('timerEnded', (roomName) => {
        io.to(roomName).emit('timerEnded'); 
    });

    socket.on('disconnect', () => {
        for (const roomName in rooms) {
            rooms[roomName].players = rooms[roomName].players.filter(p => p.id !== socket.id);
            rooms[roomName].hosts = rooms[roomName].hosts.filter(hostId => hostId !== socket.id);

            if (rooms[roomName].hosts.length === 0 && rooms[roomName].players.length > 0) {
                rooms[roomName].hosts.push(rooms[roomName].players[0].id);
            }

            io.to(roomName).emit('updatePlayers', rooms[roomName].players);
        }
    });

    socket.on('playAgain', (roomName) => {
        if (rooms[roomName].hosts.includes(socket.id)) {
            rooms[roomName].quizStarted = false;
            rooms[roomName].currentQuestionIndex = 0;
            rooms[roomName].votes = [];
            rooms[roomName].quizQuestions = [];
            rooms[roomName].isAvailable = true;
            io.to(roomName).emit('resetQuiz');
        }
    });

    socket.on('endPoll', (roomName) => {
        if (rooms[roomName]) {
            if (rooms[roomName].timerInterval) {
                clearInterval(rooms[roomName].timerInterval);
            }
            delete rooms[roomName];
            io.to(roomName).emit('redirect', { url: '../slides/index.html' });
        }
    });

    socket.on('getCurrentPlayers', (roomName) => {
        if (rooms[roomName]) {
            io.to(socket.id).emit('currentPlayers', rooms[roomName].players);
        }
    });
});

const PORT = process.env.PORT || 4000;
// const HOST = '192.168.29.153';
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});