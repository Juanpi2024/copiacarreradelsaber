// ==========================================
// GAME STATE & GLOBALS
// ==========================================
let role = null;
let peer = null;
let roomCode = '';
let connections = {};
let currentConnection = null;
let selectedLevel = '3-4'; // Default level

// Anti-repetition: tracks question hashes seen by each team
const seenQuestions = { team1: new Set(), team2: new Set() };

// ==========================================
// PROCEDURAL QUESTION GENERATOR
// ==========================================
function generateQuestion(level) {
    const ops = [];
    let a, b, text, answer;

    switch (level) {
        case '1-2': // 1°-2° Básico: sumas y restas < 20
            if (Math.random() < 0.5) {
                a = Math.floor(Math.random() * 15) + 1;
                b = Math.floor(Math.random() * (20 - a)) + 1;
                text = `${a} + ${b} = ?`; answer = a + b;
            } else {
                a = Math.floor(Math.random() * 15) + 5;
                b = Math.floor(Math.random() * a) + 1;
                text = `${a} − ${b} = ?`; answer = a - b;
            }
            break;

        case '3-4': // 3°-4° Básico: tablas de multiplicar, divisiones exactas
            const r34 = Math.random();
            if (r34 < 0.3) {
                a = Math.floor(Math.random() * 9) + 2;
                b = Math.floor(Math.random() * 9) + 2;
                text = `${a} × ${b} = ?`; answer = a * b;
            } else if (r34 < 0.5) {
                b = Math.floor(Math.random() * 9) + 2;
                answer = Math.floor(Math.random() * 9) + 2;
                a = b * answer;
                text = `${a} ÷ ${b} = ?`;
            } else if (r34 < 0.75) {
                a = Math.floor(Math.random() * 80) + 10;
                b = Math.floor(Math.random() * 50) + 10;
                text = `${a} + ${b} = ?`; answer = a + b;
            } else {
                a = Math.floor(Math.random() * 80) + 30;
                b = Math.floor(Math.random() * (a - 5)) + 5;
                text = `${a} − ${b} = ?`; answer = a - b;
            }
            break;

        case '5-6': // 5°-6° Básico: operaciones combinadas, fracciones simples
            const r56 = Math.random();
            if (r56 < 0.35) {
                a = Math.floor(Math.random() * 9) + 2;
                b = Math.floor(Math.random() * 9) + 2;
                const c = Math.floor(Math.random() * 20) + 1;
                if (Math.random() < 0.5) {
                    text = `${a} × ${b} + ${c} = ?`; answer = a * b + c;
                } else {
                    text = `${a} × ${b} − ${c} = ?`; answer = a * b - c;
                }
            } else if (r56 < 0.6) {
                const denominators = [2, 4, 5, 10];
                b = denominators[Math.floor(Math.random() * denominators.length)];
                a = Math.floor(Math.random() * (b - 1)) + 1;
                const whole = Math.floor(Math.random() * 50) + 10;
                answer = whole * a / b;
                if (Number.isInteger(answer)) {
                    text = `${a}/${b} de ${whole} = ?`;
                } else {
                    a = 1; b = 2; const w2 = (Math.floor(Math.random() * 25) + 5) * 2;
                    text = `${a}/${b} de ${w2} = ?`; answer = w2 / 2;
                }
            } else {
                a = Math.floor(Math.random() * 12) + 2;
                b = Math.floor(Math.random() * 12) + 2;
                text = `${a} × ${b} = ?`; answer = a * b;
            }
            break;

        case '7-8': // 7°-8° Básico: ecuaciones, porcentajes
            const r78 = Math.random();
            if (r78 < 0.35) {
                answer = Math.floor(Math.random() * 20) + 1;
                b = Math.floor(Math.random() * 15) + 3;
                a = Math.floor(Math.random() * 8) + 2;
                const result = a * answer + b;
                text = `${a}x + ${b} = ${result}, x = ?`;
            } else if (r78 < 0.65) {
                const percents = [10, 20, 25, 50, 75];
                a = percents[Math.floor(Math.random() * percents.length)];
                b = (Math.floor(Math.random() * 20) + 2) * (100 / a);
                b = Math.round(b);
                answer = Math.round(b * a / 100);
                text = `${a}% de ${b} = ?`;
            } else {
                a = Math.floor(Math.random() * 15) + 2;
                b = Math.floor(Math.random() * 15) + 2;
                answer = a * a + b;
                text = `${a}² + ${b} = ?`;
            }
            break;

        default:
            a = Math.floor(Math.random() * 9) + 2;
            b = Math.floor(Math.random() * 9) + 2;
            text = `${a} × ${b} = ?`; answer = a * b;
    }

    return { text, answer: Math.round(answer) };
}

// Generate a unique question for a team (anti-repetition)
function getUniqueQuestion(teamId) {
    const teamKey = `team${teamId}`;
    let attempts = 0;
    let q;
    do {
        q = generateQuestion(selectedLevel);
        attempts++;
        if (attempts > 50) {
            // Clear history if we've generated too many to avoid infinite loop
            seenQuestions[teamKey].clear();
        }
    } while (seenQuestions[teamKey].has(q.text) && attempts < 60);
    seenQuestions[teamKey].add(q.text);
    return q;
}

const WINNING_SCORE = 10;
const gameStatus = {
    team1: { score: 0, currentQuestion: null, streak: 0, bestStreak: 0, incorrect: 0, totalAnswerTimeMs: 0, lastQuestionTime: 0 },
    team2: { score: 0, currentQuestion: null, streak: 0, bestStreak: 0, incorrect: 0, totalAnswerTimeMs: 0, lastQuestionTime: 0 }
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
    // Reset scores and seen questions
    gameStatus.team1.score = 0;
    gameStatus.team2.score = 0;
    gameStatus.team1.currentQuestion = null;
    gameStatus.team2.currentQuestion = null;
    gameStatus.team1.streak = 0;
    gameStatus.team2.streak = 0;
    gameStatus.team1.bestStreak = 0;
    gameStatus.team2.bestStreak = 0;
    gameStatus.team1.incorrect = 0;
    gameStatus.team2.incorrect = 0;
    gameStatus.team1.totalAnswerTimeMs = 0;
    gameStatus.team2.totalAnswerTimeMs = 0;
    seenQuestions.team1.clear();
    seenQuestions.team2.clear();
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
    document.getElementById('display-room-code').innerText = "PREPARANDO...";

    // Read selected level from lobby
    const levelSelect = document.getElementById('level-selector');
    if (levelSelect) selectedLevel = levelSelect.value;

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
    gameStatus.team1 = { score: 0, currentQuestion: null, streak: 0, bestStreak: 0, incorrect: 0, totalAnswerTimeMs: 0, lastQuestionTime: 0 };
    gameStatus.team2 = { score: 0, currentQuestion: null, streak: 0, bestStreak: 0, incorrect: 0, totalAnswerTimeMs: 0, lastQuestionTime: 0 };
    seenQuestions.team1.clear();
    seenQuestions.team2.clear();
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
    if (connections[teamId]) {
        const ts = gameStatus[`team${teamId}`];
        const q = getUniqueQuestion(teamId);
        ts.currentQuestion = q;
        ts.lastQuestionTime = Date.now();
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
    if (data.type === 'ANSWER_SUBMIT') {
        const ts = gameStatus[`team${teamId}`];
        if (!ts.currentQuestion) return;
        const correct = ts.currentQuestion.answer;
        const submitted = parseInt(data.value);

        if (submitted === correct) {
            // Track answer time
            if (ts.lastQuestionTime) ts.totalAnswerTimeMs += (Date.now() - ts.lastQuestionTime);
            ts.score += 1;
            ts.streak += 1;
            if (ts.streak > ts.bestStreak) ts.bestStreak = ts.streak;
            updateAvatars();
            updateScoreDisplay();
            updateStreakDisplay();
            connections[teamId].send({ type: 'CORRECT', streak: ts.streak });

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
            ts.streak = 0;
            ts.incorrect += 1;
            updateStreakDisplay();
            // After freeze, buzzer will request a new question
        }
    }
}

function updateAvatars() {
    const p1 = Math.min((gameStatus.team1.score / WINNING_SCORE) * 100, 100);
    const p2 = Math.min((gameStatus.team2.score / WINNING_SCORE) * 100, 100);
    document.getElementById('avatar-1').style.left = `${2 + p1 * 0.85}%`;
    document.getElementById('avatar-2').style.left = `${2 + p2 * 0.85}%`;
    const pf1 = document.getElementById('progress-fill-1');
    const pf2 = document.getElementById('progress-fill-2');
    if (pf1) pf1.style.width = `${p1}%`;
    if (pf2) pf2.style.width = `${p2}%`;
}

// ==========================================
// STREAK DISPLAY (🔥)
// ==========================================
function updateStreakDisplay() {
    [1, 2].forEach(id => {
        const streak = gameStatus[`team${id}`].streak;
        const el = document.getElementById(`streak-${id}`);
        if (!el) return;
        if (streak >= 2) {
            let fires = '🔥';
            if (streak >= 7) fires = '🔥🔥🔥';
            else if (streak >= 5) fires = '🔥🔥';
            el.innerText = `${fires} ×${streak}`;
            el.classList.remove('hidden');
            el.classList.add('streak-pop');
            setTimeout(() => el.classList.remove('streak-pop'), 400);
        } else {
            el.classList.add('hidden');
        }
    });
}

function showVictory(teamId, timeStr) {
    const vo = document.getElementById('victory-overlay');
    vo.classList.remove('hidden');
    vo.classList.add('active');
    document.getElementById('victory-text').innerText = '🎉 ¡VICTORIA! 🎉';
    document.getElementById('victory-team').innerText = `EQUIPO ${teamId} gana en ${timeStr}`;
    launchConfetti();

    // Build post-race summary
    const summaryEl = document.getElementById('post-race-summary');
    if (summaryEl) {
        let html = '<div class="summary-grid">';
        [1, 2].forEach(id => {
            const ts = gameStatus[`team${id}`];
            const total = ts.score + ts.incorrect;
            const accuracy = total > 0 ? Math.round((ts.score / total) * 100) : 0;
            const avgTime = ts.score > 0 ? (ts.totalAnswerTimeMs / ts.score / 1000).toFixed(1) : '—';
            const isWinner = id == teamId;
            html += `
                <div class="summary-card ${isWinner ? 'summary-winner' : ''} ${id === 1 ? 'card-blue' : 'card-pink'}">
                    <div class="summary-team">${isWinner ? '🏆 ' : ''}EQUIPO ${id}</div>
                    <div class="summary-stats">
                        <div class="stat-row"><span class="stat-label">✅ Correctas</span><span class="stat-value">${ts.score}</span></div>
                        <div class="stat-row"><span class="stat-label">❌ Incorrectas</span><span class="stat-value">${ts.incorrect}</span></div>
                        <div class="stat-row"><span class="stat-label">🎯 Precisión</span><span class="stat-value">${accuracy}%</span></div>
                        <div class="stat-row"><span class="stat-label">🔥 Mejor racha</span><span class="stat-value">${ts.bestStreak}</span></div>
                        <div class="stat-row"><span class="stat-label">⏱️ Promedio</span><span class="stat-value">${avgTime}s</span></div>
                    </div>
                </div>`;
        });
        html += '</div>';
        summaryEl.innerHTML = html;
        summaryEl.classList.remove('hidden');
    }
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
                // Show streak on buzzer
                if (data.streak && data.streak >= 2) {
                    let fires = '🔥';
                    if (data.streak >= 7) fires = '🔥🔥🔥';
                    else if (data.streak >= 5) fires = '🔥🔥';
                    const th = document.getElementById('buzzer-team-name');
                    th.innerText = `EQUIPO ${buzzerTeamId} ${fires}×${data.streak}`;
                }
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
