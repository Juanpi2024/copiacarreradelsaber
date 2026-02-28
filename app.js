// ==========================================
// GAME STATE & GLOBALS
// ==========================================
let role = null;
let peer = null;
let roomCode = '';
let connections = {};
let currentConnection = null;
let gameQuestions = [];

// Mock questions for offline testing
const mockupQuestions = [
    { text: "7 × 8 = ?", answer: 56 },
    { text: "45 + 17 = ?", answer: 62 },
    { text: "100 − 25 = ?", answer: 75 },
    { text: "9 × 9 = ?", answer: 81 },
    { text: "30 ÷ 5 = ?", answer: 6 },
    { text: "12 + 18 = ?", answer: 30 },
    { text: "6 × 7 = ?", answer: 42 },
    { text: "50 − 15 = ?", answer: 35 },
    { text: "8 × 4 = ?", answer: 32 },
    { text: "100 ÷ 10 = ?", answer: 10 },
    { text: "¿Mitad de 50?", answer: 25 },
    { text: "6 × 6 = ?", answer: 36 },
    { text: "3 × 12 = ?", answer: 36 },
    { text: "48 ÷ 6 = ?", answer: 8 },
    { text: "99 − 33 = ?", answer: 66 },
    { text: "25 + 37 = ?", answer: 62 },
    { text: "11 × 4 = ?", answer: 44 },
    { text: "72 ÷ 8 = ?", answer: 9 },
    { text: "150 − 80 = ?", answer: 70 },
    { text: "5 × 5 × 2 = ?", answer: 50 }
];

const WINNING_SCORE = 10;
const gameStatus = {
    team1: { score: 0, currentQuestionIndex: 0 },
    team2: { score: 0, currentQuestionIndex: 0 }
};
let gameStartTime = null;

// ==========================================
// SCREEN NAVIGATION
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function goLobby() {
    if (peer) { peer.destroy(); peer = null; }
    role = null;
    connections = {};
    // Reset scores
    gameStatus.team1.score = 0;
    gameStatus.team2.score = 0;
    gameStatus.team1.currentQuestionIndex = 0;
    gameStatus.team2.currentQuestionIndex = 0;
    // Hide victory
    const vo = document.getElementById('victory-overlay');
    if (vo) { vo.classList.add('hidden'); vo.classList.remove('active'); }
    showScreen('lobby-screen');
}

// ==========================================
// PEER.JS UTILS
// ==========================================
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
    let result = '';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// ==========================================
// HOST LOGIC
// ==========================================
async function initHostMode(is1v1 = false) {
    role = 'HOST';
    showScreen('host-screen');
    document.getElementById('display-room-code').innerText = "CARGANDO...";

    // Load questions
    try {
        if (typeof fetchQuestionsFromGAS === "function") {
            const fetched = await fetchQuestionsFromGAS();
            gameQuestions = (fetched && fetched.length > 5) ? fetched : mockupQuestions;
        } else {
            gameQuestions = mockupQuestions;
        }
    } catch (e) {
        console.warn("GAS failed, using mockups");
        gameQuestions = mockupQuestions;
    }

    // Shuffle questions
    for (let i = gameQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameQuestions[i], gameQuestions[j]] = [gameQuestions[j], gameQuestions[i]];
    }

    roomCode = generateRoomCode();
    document.getElementById('display-room-code').innerText = roomCode;

    // Split board
    const splitBoard = document.getElementById('split-board-container');
    if (is1v1) {
        splitBoard.classList.remove('hidden');
        splitBoard.classList.add('active');
    } else {
        splitBoard.classList.add('hidden');
        splitBoard.classList.remove('active');
    }

    // Victory overlay reset
    const vo = document.getElementById('victory-overlay');
    vo.classList.add('hidden');
    vo.classList.remove('active');

    // PeerJS Host
    const hostPeerId = `mathrace-${roomCode}`;
    peer = new Peer(hostPeerId);

    peer.on('open', () => console.log('Host ready:', hostPeerId));

    peer.on('connection', (conn) => {
        conn.on('open', () => {
            const teamId = conn.metadata.team;
            connections[teamId] = conn;
            updateConnectionCount();
            sendQuestionToTeam(teamId);
            if (!gameStartTime) gameStartTime = Date.now();
        });
        conn.on('data', (data) => handleHostData(conn.metadata.team, data));
        conn.on('close', () => { delete connections[conn.metadata.team]; updateConnectionCount(); });
    });

    // Reset game
    gameStatus.team1 = { score: 0, currentQuestionIndex: 0 };
    gameStatus.team2 = { score: 0, currentQuestionIndex: 1 };
    gameStartTime = null;
    updateAvatars();
    updateScoreDisplay();
}

function updateConnectionCount() {
    const count = Object.keys(connections).length;
    document.getElementById('connected-count').innerText = count;
    // Hide waiting message once at least 1 team connects
    const wm = document.getElementById('waiting-msg');
    if (wm) wm.style.display = count > 0 ? 'none' : 'flex';
}

function updateScoreDisplay() {
    const s1 = document.getElementById('score-1');
    const s2 = document.getElementById('score-2');
    if (s1) s1.innerText = gameStatus.team1.score;
    if (s2) s2.innerText = gameStatus.team2.score;
}

function sendQuestionToTeam(teamId) {
    if (connections[teamId] && gameQuestions.length > 0) {
        const ts = gameStatus[`team${teamId}`];
        const qi = ts.currentQuestionIndex % gameQuestions.length;
        const q = gameQuestions[qi];
        connections[teamId].send({ type: 'NEW_QUESTION', text: q.text });
        // Update host split board
        const el = document.getElementById(`host-question-${teamId}`);
        if (el) el.innerText = q.text;
    }
}

function handleHostData(teamId, data) {
    if (data.type === 'REQUEST_NEW') {
        sendQuestionToTeam(teamId);
        return;
    }
    if (data.type === 'ANSWER_SUBMIT' && gameQuestions.length > 0) {
        const ts = gameStatus[`team${teamId}`];
        const qi = ts.currentQuestionIndex % gameQuestions.length;
        const correct = gameQuestions[qi].answer;
        const submitted = parseInt(data.value);

        if (submitted === correct) {
            ts.score += 1;
            ts.currentQuestionIndex += 1;
            updateAvatars();
            updateScoreDisplay();
            connections[teamId].send({ type: 'CORRECT' });

            if (ts.score >= WINNING_SCORE) {
                // VICTORY!
                const elapsed = gameStartTime ? Math.round((Date.now() - gameStartTime) / 1000) : 0;
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

                Object.values(connections).forEach(c => c.send({ type: 'GAME_OVER', winner: teamId }));
                showVictory(teamId, timeStr);

                if (typeof sendMetricsToGAS === "function") {
                    sendMetricsToGAS(teamId, timeStr);
                }
            } else {
                sendQuestionToTeam(teamId);
            }
        } else {
            connections[teamId].send({ type: 'FREEZE_PENALTY', seconds: 3 });
            // New random question after penalty
            ts.currentQuestionIndex = Math.floor(Math.random() * gameQuestions.length);
        }
    }
}

function updateAvatars() {
    const p1 = Math.min((gameStatus.team1.score / WINNING_SCORE) * 100, 100);
    const p2 = Math.min((gameStatus.team2.score / WINNING_SCORE) * 100, 100);
    // Move runner characters
    document.getElementById('avatar-1').style.left = `${2 + p1 * 0.85}%`;
    document.getElementById('avatar-2').style.left = `${2 + p2 * 0.85}%`;
    // Fill progress bars
    const pf1 = document.getElementById('progress-fill-1');
    const pf2 = document.getElementById('progress-fill-2');
    if (pf1) pf1.style.width = `${p1}%`;
    if (pf2) pf2.style.width = `${p2}%`;
}

function showVictory(teamId, timeStr) {
    const vo = document.getElementById('victory-overlay');
    vo.classList.remove('hidden');
    vo.classList.add('active');
    document.getElementById('victory-text').innerText = '🎉 ¡VICTORIA! 🎉';
    document.getElementById('victory-team').innerText = `EQUIPO ${teamId} gana en ${timeStr}`;
    launchConfetti();
}

// ==========================================
// CONFETTI ENGINE
// ==========================================
function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#00e5ff', '#d946ef', '#39ff14', '#fbbf24', '#ff3366', '#00a2ff', '#f0abfc'];

    for (let i = 0; i < 200; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 12 + 4,
            h: Math.random() * 8 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360,
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 4 + 2,
            vr: (Math.random() - 0.5) * 8,
            opacity: 1
        });
    }

    let frames = 0;
    function animate() {
        if (frames > 300) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            p.vy += 0.05; // gravity
            if (frames > 200) p.opacity -= 0.01;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        frames++;
        requestAnimationFrame(animate);
    }
    animate();
}

// ==========================================
// BUZZER LOGIC
// ==========================================
let buzzerTeamId = null;

function initBuzzerMode() {
    role = 'BUZZER';
    showScreen('buzzer-screen');
    document.getElementById('join-section').classList.remove('hidden');
    document.getElementById('gameplay-section').classList.add('hidden');
    document.getElementById('input-room-code').value = '';
    setTimeout(() => document.getElementById('input-room-code').focus(), 100);
}

function joinRoom() {
    const code = document.getElementById('input-room-code').value.toUpperCase();
    const team = document.getElementById('team-selector').value;

    if (code.length !== 4) { alert("El código debe tener 4 caracteres."); return; }

    buzzerTeamId = team;
    const hostPeerId = `mathrace-${code}`;
    peer = new Peer();

    peer.on('open', () => {
        currentConnection = peer.connect(hostPeerId, { metadata: { team: team } });

        currentConnection.on('open', () => {
            document.getElementById('join-section').classList.add('hidden');
            document.getElementById('gameplay-section').classList.remove('hidden');
            const th = document.getElementById('buzzer-team-name');
            th.innerText = `EQUIPO ${team}`;
            th.className = `team-header team-${team}-theme`;
        });

        currentConnection.on('data', (data) => {
            if (data.type === 'NEW_QUESTION') {
                document.getElementById('buzzer-question-display').innerText = data.text;
                clearNum();
            }
            if (data.type === 'CORRECT') {
                showCorrectFlash();
            }
            if (data.type === 'FREEZE_PENALTY') {
                applyFreeze(data.seconds);
            }
            if (data.type === 'GAME_OVER') {
                const isWinner = data.winner == buzzerTeamId;
                document.getElementById('buzzer-question-display').innerText =
                    isWinner ? "🏆 ¡GANASTE! 🏆" : "😓 FIN DEL JUEGO";
                if (isWinner) {
                    document.querySelector('.buzzer-question').style.color = '#fbbf24';
                }
            }
        });

        currentConnection.on('error', () => {
            alert("Error de conexión. Verifica el código de sala.");
            goLobby();
        });
    });

    peer.on('error', () => {
        alert("No se pudo conectar. ¿Está el Host activo?");
        goLobby();
    });
}

// ==========================================
// NUMPAD
// ==========================================
function getAnswerInput() { return document.getElementById('answer-input'); }

function appendNum(num) {
    const inp = getAnswerInput();
    if (inp.value.length < 6) inp.value += num;
}

function appendNeg() {
    const inp = getAnswerInput();
    if (inp.value.startsWith('-')) {
        inp.value = inp.value.substring(1);
    } else {
        inp.value = '-' + inp.value;
    }
}

function clearNum() { getAnswerInput().value = ''; }

function submitAnswer() {
    const inp = getAnswerInput();
    if (!inp.value || !currentConnection) return;
    currentConnection.send({ type: 'ANSWER_SUBMIT', value: inp.value });
}

// ==========================================
// VISUAL FEEDBACK (Buzzer)
// ==========================================
function applyFreeze(seconds) {
    const overlay = document.getElementById('freeze-overlay');
    const timer = document.getElementById('freeze-timer');
    overlay.classList.remove('hidden');
    clearNum();
    let remaining = seconds;
    timer.innerText = remaining;

    const interval = setInterval(() => {
        remaining--;
        timer.innerText = remaining;
        if (remaining <= 0) {
            clearInterval(interval);
            overlay.classList.add('hidden');
            if (currentConnection) currentConnection.send({ type: 'REQUEST_NEW' });
        }
    }, 1000);
}

function showCorrectFlash() {
    const flash = document.getElementById('correct-flash');
    flash.classList.remove('hidden');
    setTimeout(() => flash.classList.add('hidden'), 600);
}
