// ==========================================
// GAME STATE & GLOBALS
// ==========================================
let role = null; // 'HOST' or 'BUZZER'
let peer = null;
let roomCode = '';
let connections = {}; // For HOST to track buzzers
let currentConnection = null; // For BUZZER to track host

// Mock questions for Phase 1 (Before GAS integration)
const mockupQuestions = [
    { text: "7 x 8 = ?", answer: 56 },
    { text: "45 + 17 = ?", answer: 62 },
    { text: "100 - 25 = ?", answer: 75 },
    { text: "9 x 9 = ?", answer: 81 },
    { text: "30 / 5 = ?", answer: 6 },
    { text: "12 + 18 = ?", answer: 30 },
    { text: "6 x 7 = ?", answer: 42 },
    { text: "50 - 15 = ?", answer: 35 },
    { text: "8 x 4 = ?", answer: 32 },
    { text: "100 / 10 = ?", answer: 10 },
    { text: "¿Mitad de 50?", answer: 25 },
    { text: "6 x 6 = ?", answer: 36 }
];

// Progress tracking
const WINNING_SCORE = 10;
const gameStatus = {
    team1: { score: 0, currentQuestionIndex: 0 },
    team2: { score: 0, currentQuestionIndex: 0 }
};

// ==========================================
// SCREEN NAVIGATION
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function goLobby() {
    if (peer) {
        peer.destroy();
        peer = null;
    }
    role = null;
    showScreen('lobby-screen');
}

// ==========================================
// PEER.JS UTILS
// ==========================================
// Generate simple 4 letter room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ==========================================
// HOST LOGIC (Main Screen)
// ==========================================
function initHostMode(is1v1 = false) {
    role = 'HOST';
    roomCode = generateRoomCode();
    document.getElementById('display-room-code').innerText = roomCode;
    showScreen('host-screen');

    if (is1v1) {
        document.getElementById('split-board-container').classList.remove('hidden');
        document.getElementById('split-board-container').classList.add('active');
    } else {
        document.getElementById('split-board-container').classList.add('hidden');
        document.getElementById('split-board-container').classList.remove('active');
    }

    // Create unique ID for host using the roomCode
    const hostPeerId = `mathrace-${roomCode}`;
    peer = new Peer(hostPeerId);

    peer.on('open', (id) => {
        console.log('Host created with ID:', id);
    });

    peer.on('connection', (conn) => {
        console.log('Buzzer connecting...', conn.metadata);

        conn.on('open', () => {
            // Register connection
            const teamId = conn.metadata.team;
            connections[teamId] = conn;
            updateConnectionCount();

            // Send initial question to buzzer
            sendQuestionToTeam(teamId);
        });

        conn.on('data', (data) => {
            handleHostReceivedData(conn.metadata.team, data);
        });

        conn.on('close', () => {
            delete connections[conn.metadata.team];
            updateConnectionCount();
        });
    });

    // Reset game state
    gameStatus.team1.score = 0;
    gameStatus.team2.score = 0;
    gameStatus.team1.currentQuestionIndex = 0;
    gameStatus.team2.currentQuestionIndex = 1; // Different starting question
    updateAvatars();
}

function updateConnectionCount() {
    const count = Object.keys(connections).length;
    document.getElementById('connected-count').innerText = count;
}

function sendQuestionToTeam(teamId) {
    if (connections[teamId]) {
        const teamState = gameStatus[`team${teamId}`];
        // Loop questions if we run out
        const qIndex = teamState.currentQuestionIndex % mockupQuestions.length;
        const q = mockupQuestions[qIndex];

        connections[teamId].send({
            type: 'NEW_QUESTION',
            text: q.text
        });

        // Update host split screen if visible
        const hostQEl = document.getElementById(`host-question-${teamId}`);
        if (hostQEl) {
            hostQEl.innerText = q.text;
        }
    }
}

function handleHostReceivedData(teamId, data) {
    if (data.type === 'ANSWER_SUBMIT') {
        const teamState = gameStatus[`team${teamId}`];
        const qIndex = teamState.currentQuestionIndex % mockupQuestions.length;
        const correctAnswer = mockupQuestions[qIndex].answer;
        const submittedAnswer = parseInt(data.value);

        if (submittedAnswer === correctAnswer) {
            // CORRECT
            teamState.score += 1;
            teamState.currentQuestionIndex += 1;

            updateAvatars();

            if (teamState.score >= WINNING_SCORE) {
                // WIN
                alert(`¡EL EQUIPO ${teamId} HA GANADO LA CARRERA!`);
                // Broadcast win to all
                Object.values(connections).forEach(c => c.send({ type: 'GAME_OVER', winner: teamId }));
            } else {
                // Send next
                sendQuestionToTeam(teamId);
            }
        } else {
            // INCORRECT
            connections[teamId].send({ type: 'FREEZE_PENALTY', seconds: 3 });
            // Give them a different question after freeze
            teamState.currentQuestionIndex = Math.floor(Math.random() * mockupQuestions.length);
        }
    }
}

function updateAvatars() {
    // Score out of 10, each point is 100/WINNING_SCORE % distance
    const percent1 = Math.min((gameStatus.team1.score / WINNING_SCORE) * 100, 100);
    const percent2 = Math.min((gameStatus.team2.score / WINNING_SCORE) * 100, 100);

    // The finish line is at the right edge, but avatar has width, so we limit to ~85vw
    document.getElementById('avatar-1').style.transform = `translateX(calc(${percent1}vw * 0.85))`;
    document.getElementById('avatar-2').style.transform = `translateX(calc(${percent2}vw * 0.85))`;
}

// ==========================================
// BUZZER LOGIC (Tablet)
// ==========================================
function initBuzzerMode(mode) {
    role = 'BUZZER';
    showScreen('buzzer-screen');
    document.getElementById('join-section').classList.remove('hidden');
    document.getElementById('gameplay-section').classList.add('hidden');

    // Auto-focus input
    document.getElementById('input-room-code').value = '';
    document.getElementById('input-room-code').focus();
}

function joinRoom() {
    const code = document.getElementById('input-room-code').value.toUpperCase();
    const team = document.getElementById('team-selector').value;

    if (code.length !== 4) {
        alert("El código debe tener 4 caracteres.");
        return;
    }

    const hostPeerId = `mathrace-${code}`;
    peer = new Peer();

    peer.on('open', (id) => {
        console.log('Buzzer initialized, connecting to host...');
        currentConnection = peer.connect(hostPeerId, { metadata: { team: team } });

        currentConnection.on('open', () => {
            console.log('Connected to Host!');

            // Switch UI
            document.getElementById('join-section').classList.add('hidden');
            document.getElementById('gameplay-section').classList.remove('hidden');

            const teamNameEl = document.getElementById('buzzer-team-name');
            teamNameEl.innerText = `EQUIPO ${team}`;
            teamNameEl.className = `team-header team-${team}-theme`;
        });

        currentConnection.on('data', (data) => {
            if (data.type === 'NEW_QUESTION') {
                document.getElementById('buzzer-question-display').innerText = data.text;
                clearNum(); // Reset input field
            }
            if (data.type === 'FREEZE_PENALTY') {
                applyFreeze(data.seconds);
            }
            if (data.type === 'GAME_OVER') {
                document.getElementById('buzzer-question-display').innerText =
                    data.winner == team ? "¡GANASTE!" : "FIN DEL JUEGO";
            }
        });

        currentConnection.on('error', (err) => {
            alert("Error de conexión. Verifica el código de sala.");
            goLobby();
        });
    });
}

// ==========================================
// BUZZER NUMPAD LOGIC
// ==========================================
const answerInput = document.getElementById('answer-input');

function appendNum(num) {
    if (answerInput.value.length < 5) {
        answerInput.value += num;
    }
}

function clearNum() {
    answerInput.value = '';
}

function submitAnswer() {
    if (!answerInput.value || !currentConnection) return;

    currentConnection.send({
        type: 'ANSWER_SUBMIT',
        value: answerInput.value
    });
}

function applyFreeze(seconds) {
    const overlay = document.getElementById('freeze-overlay');
    overlay.classList.remove('hidden');
    clearNum(); // wipe their input
    setTimeout(() => {
        overlay.classList.add('hidden');
        // The host handles sending the new question immediately if needed, 
        // or we request one. By design, the host updates the index when giving penalty, 
        // so we just request the host to send what's next.
        if (currentConnection) {
            currentConnection.send({ type: 'REQUEST_NEW' });
        }

        // Host logic above needs minor tweak to intercept REQUEST_NEW:
    }, seconds * 1000);
}

// Add simple interceptor for REQUEST_NEW in host
const originalHostRecv = handleHostReceivedData;
handleHostReceivedData = function (teamId, data) {
    if (data.type === 'REQUEST_NEW') {
        sendQuestionToTeam(teamId);
    } else {
        originalHostRecv(teamId, data);
    }
}
