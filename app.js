// ==========================================
// GAME STATE & GLOBALS
// ==========================================
let role = null;
let peer = null;
let roomCode = '';
let connections = {};
let currentConnection = null;
let selectedLevel = '3-4'; // Default level
let selectedSubject = 'matematicas'; // Default subject

// Anti-repetition: tracks question hashes seen by each team
const seenQuestions = {};

// ==========================================
// QUESTION GENERATION (delegated to modules)
// ==========================================
function generateQuestion(level, difficulty) {
    const mod = window.QuestionModules[selectedSubject];
    if (!mod) { console.error('No question module for:', selectedSubject); return { text: '???', answer: 0 }; }
    return mod.generateQuestion(level, difficulty);
}

// Generate a unique question for a team (anti-repetition + adaptive difficulty)
function getUniqueQuestion(teamId) {
    const ts = gameStatus[teamId];
    let attempts = 0;
    let q;
    do {
        q = generateQuestion(selectedLevel, ts ? ts.difficultyLevel : 2);
        attempts++;
        if (attempts > 50) {
            seenQuestions[teamId].clear();
        }
    } while (seenQuestions[teamId].has(q.text) && attempts < 60);
    seenQuestions[teamId].add(q.text);
    return q;
}

const WINNING_SCORE = 10;
const TURBO_TIME_MS = 3000;
const SHIELD_STREAK = 5;
const DIFF_UP_STREAK = 3;   // Consecutive correct to increase difficulty
const DIFF_DOWN_MISS = 2;   // Consecutive incorrect to decrease difficulty
let gameStatus = {};
let gameStartTime = null;
let playerCounter = 0; // Para asignar IDs de UI únicos

// Anti-pegado timer
const questionTimers = {};
const QUESTION_TIMEOUT_S = 45;

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
    gameStatus = {};
    for (let key in seenQuestions) delete seenQuestions[key];
    playerCounter = 0;
    // Clear anti-pegado timers
    Object.keys(questionTimers).forEach(k => { clearTimeout(questionTimers[k]); delete questionTimers[k]; });
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

    // Read selected level and subject from lobby
    const levelSelect = document.getElementById('level-selector');
    if (levelSelect) selectedLevel = levelSelect.value;
    const subjectSelect = document.getElementById('subject-selector');
    if (subjectSelect) selectedSubject = subjectSelect.value;

    roomCode = generateRoomCode();
    document.getElementById('display-room-code').innerText = roomCode;

    // Removed splitboard logic

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
            const tId = conn.metadata.team || 'Jugador';
            const teamId = tId.trim();
            // Re-assign metadata to sanitized version
            conn.metadata.team = teamId;
            connections[teamId] = conn;
            // Initialize new player if not exists
            if (!gameStatus[teamId]) {
                gameStatus[teamId] = { score: 0, currentQuestion: null, streak: 0, bestStreak: 0, incorrect: 0, totalAnswerTimeMs: 0, lastQuestionTime: 0, hasShield: false, turboCount: 0, difficultyLevel: 2, consecutiveWrong: 0 };
                seenQuestions[teamId] = new Set();
                createPlayerTrack(teamId);
            }
            updateConnectionCount();
            sendQuestionToTeam(teamId);
            if (!gameStartTime) gameStartTime = Date.now();
        });
        conn.on('data', (data) => handleHostData(conn.metadata.team, data));
        conn.on('close', () => {
            const tid = conn.metadata.team;
            delete connections[tid];
            if (questionTimers[tid]) { clearTimeout(questionTimers[tid]); delete questionTimers[tid]; }
            updateConnectionCount();
        });
    });

    // Reset game dynamically
    gameStatus = {};
    for (let key in seenQuestions) delete seenQuestions[key];
    const lanesContainer = document.getElementById('lanes-container');
    if (lanesContainer) lanesContainer.innerHTML = '';
    playerCounter = 0;
    gameStartTime = null;
    updateAvatars();
}

function createPlayerTrack(teamId) {
    playerCounter++;
    // Generar un color o tema aleatorio o basado en ID
    const colors = ['blue', 'pink', 'green', 'yellow', 'cyan', 'orange'];
    const trackColor = colors[playerCounter % colors.length];

    // Asignamos una ID de UI a este teamId
    gameStatus[teamId].uiId = playerCounter;

    const container = document.getElementById('lanes-container');
    if (!container) return;

    const laneDiv = document.createElement('div');
    laneDiv.className = `race-lane lane-${trackColor}`;
    laneDiv.innerHTML = `
        <div class="lane-label">${teamId} <span id="streak-${playerCounter}" class="streak-badge hidden"></span></div>
        <div class="progress-track">
            <div class="progress-fill" id="progress-fill-${playerCounter}" style="background: var(--accent-${trackColor}); box-shadow: 0 0 20px var(--accent-${trackColor});"></div>
            <div class="progress-markers">
                <span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
            </div>
        </div>
        <div class="lane-runner" id="avatar-${playerCounter}">
            <div class="runner-character ${trackColor}-char">
                <div class="char-ear char-ear-l"></div>
                <div class="char-ear char-ear-r"></div>
                <div class="char-head">
                    <div class="char-eye eye-l"></div>
                    <div class="char-eye eye-r"></div>
                    <div class="char-mouth"></div>
                </div>
                <div class="char-body"></div>
                <div class="char-legs">
                    <div class="char-leg leg-l"></div>
                    <div class="char-leg leg-r"></div>
                </div>
            </div>
        </div>
        <div class="finish-marker">🏁</div>
    `;
    container.appendChild(laneDiv);
}

function updateConnectionCount() {
    const count = Object.keys(connections).length;
    document.getElementById('connected-count').innerText = count;
    // Hide waiting message once at least 1 team connects
    const wm = document.getElementById('waiting-msg');
    if (wm) wm.style.display = count > 0 ? 'none' : 'flex';
}

function updateScoreDisplay() {
    // Ya no actualizamos `#score-1` o `#score-2` porque se eliminaron
}

function sendQuestionToTeam(teamId) {
    if (connections[teamId]) {
        const ts = gameStatus[`team${teamId}`];
        const q = getUniqueQuestion(teamId);
        ts.currentQuestion = q;
        ts.lastQuestionTime = Date.now();
        // Clear existing anti-pegado timer
        if (questionTimers[teamId]) clearTimeout(questionTimers[teamId]);
        // Start new anti-pegado timer
        questionTimers[teamId] = setTimeout(() => handleQuestionTimeout(teamId), QUESTION_TIMEOUT_S * 1000);
        // Get answer type from module
        const mod = window.QuestionModules[selectedSubject];
        const answerType = mod ? mod.answerType : 'numeric';
        const payload = { type: 'NEW_QUESTION', text: q.text, timeLimit: QUESTION_TIMEOUT_S, answerType: answerType };
        if (q.options) payload.options = q.options;
        connections[teamId].send(payload);
        // Update host split board (eliminado)
    }
}

function handleHostData(teamId, data) {
    if (data.type === 'REQUEST_NEW') {
        if (questionTimers[teamId]) { clearTimeout(questionTimers[teamId]); delete questionTimers[teamId]; }
        sendQuestionToTeam(teamId);
        return;
    }
    if (data.type === 'ANSWER_SUBMIT') {
        // Clear anti-pegado timer
        if (questionTimers[teamId]) { clearTimeout(questionTimers[teamId]); delete questionTimers[teamId]; }
        const ts = gameStatus[teamId];
        if (!ts || !ts.currentQuestion) return;
        const correct = ts.currentQuestion.answer;
        const submitted = parseInt(data.value);

        if (submitted === correct) {
            // Track answer time
            const answerMs = ts.lastQuestionTime ? (Date.now() - ts.lastQuestionTime) : 9999;
            ts.totalAnswerTimeMs += answerMs;

            // ⚡ TURBO: answer under 3s = +2
            const isTurbo = answerMs < TURBO_TIME_MS;
            const points = isTurbo ? 2 : 1;
            ts.score = Math.min(ts.score + points, WINNING_SCORE);
            if (isTurbo) ts.turboCount += 1;

            ts.streak += 1;
            ts.consecutiveWrong = 0; // Reset consecutive wrong on correct
            if (ts.streak > ts.bestStreak) ts.bestStreak = ts.streak;

            // 📈 ADAPTIVE DIFFICULTY: increase at streak milestones
            let diffUp = false;
            if (ts.streak > 0 && ts.streak % DIFF_UP_STREAK === 0 && ts.difficultyLevel < 3) {
                ts.difficultyLevel += 1;
                diffUp = true;
            }

            // 🛡️ SHIELD: earned at streak 5
            let shieldEarned = false;
            if (ts.streak === SHIELD_STREAK && !ts.hasShield) {
                ts.hasShield = true;
                shieldEarned = true;
            }

            updateAvatars();
            updateScoreDisplay();
            updateStreakDisplay();

            // 🎆 HOST SCREEN EPIC NOTIFICATIONS
            let notifDelay = 0;
            if (isTurbo) {
                showHostNotification('⚡ ¡TURBO! +2 ⚡', 'turbo', teamId);
                notifDelay = 800;
            }
            if (ts.streak === 3 || ts.streak === 5 || ts.streak === 7 || (ts.streak >= 10 && ts.streak % 5 === 0)) {
                setTimeout(() => showHostNotification(`🔥 ¡RACHA ×${ts.streak}!`, 'streak', teamId), notifDelay);
                notifDelay += 800;
            }
            if (shieldEarned) {
                setTimeout(() => showHostNotification('🛡️ ¡ESCUDO ACTIVADO!', 'shield', teamId), notifDelay);
                notifDelay += 800;
            }
            if (diffUp) {
                const diffNames = { 2: '¡NIVEL MEDIO!', 3: '¡NIVEL DIFÍCIL!' };
                setTimeout(() => showHostNotification(`📈 ${diffNames[ts.difficultyLevel] || '¡NIVEL UP!'}`, 'diffup', teamId), notifDelay);
            }

            connections[teamId].send({
                type: 'CORRECT',
                streak: ts.streak,
                turbo: isTurbo,
                points: points,
                shieldEarned: shieldEarned,
                hasShield: ts.hasShield,
                difficulty: ts.difficultyLevel
            });

            if (ts.score >= WINNING_SCORE) {
                // VICTORY! Clear all timers
                Object.keys(questionTimers).forEach(k => { clearTimeout(questionTimers[k]); delete questionTimers[k]; });
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
            // 🛡️ SHIELD: blocks freeze
            if (ts.hasShield) {
                ts.hasShield = false;
                connections[teamId].send({ type: 'SHIELD_USED' });
                showHostNotification('🛡️ ¡SALVADO!', 'shield-used', teamId);
                // No freeze, just send new question
                sendQuestionToTeam(teamId);
            } else {
                connections[teamId].send({ type: 'FREEZE_PENALTY', seconds: 3 });
            }
            ts.streak = 0;
            ts.incorrect += 1;
            ts.consecutiveWrong += 1;

            // 📉 ADAPTIVE DIFFICULTY: decrease after consecutive wrong
            if (ts.consecutiveWrong >= DIFF_DOWN_MISS && ts.difficultyLevel > 1) {
                ts.difficultyLevel -= 1;
                ts.consecutiveWrong = 0;
                showHostNotification('📉 NIVEL AJUSTADO', 'diffdown', teamId);
            }
            updateStreakDisplay();
        }
    }
}

function updateAvatars() {
    for (let teamId in gameStatus) {
        const ts = gameStatus[teamId];
        const uiId = ts.uiId;
        const p = Math.min((ts.score / WINNING_SCORE) * 100, 100);
        const avatarEl = document.getElementById(`avatar-${uiId}`);
        const fillEl = document.getElementById(`progress-fill-${uiId}`);
        if (avatarEl) avatarEl.style.left = `${2 + p * 0.85}%`;
        if (fillEl) fillEl.style.width = `${p}%`;
    }
}

// ==========================================
// STREAK DISPLAY (🔥)
// ==========================================
function updateStreakDisplay() {
    const diffLabels = { 1: '🟢', 2: '🟡', 3: '🔴' };
    for (let teamId in gameStatus) {
        const ts = gameStatus[teamId];
        const uiId = ts.uiId;
        const streak = ts.streak;
        const el = document.getElementById(`streak-${uiId}`);
        if (!el) continue;
        const diffIcon = diffLabels[ts.difficultyLevel] || '🟡';
        if (streak >= 2) {
            let fires = '🔥';
            if (streak >= 7) fires = '🔥🔥🔥';
            else if (streak >= 5) fires = '🔥🔥';
            el.innerText = `${fires}×${streak} ${diffIcon}`;
            el.classList.remove('hidden');
            el.classList.add('streak-pop');
            setTimeout(() => el.classList.remove('streak-pop'), 400);
        } else {
            el.innerText = diffIcon;
            el.classList.remove('hidden');
        }
    }
}

// ==========================================
// HOST EPIC NOTIFICATIONS
// ==========================================
function showHostNotification(text, type, teamId) {
    const container = document.getElementById('host-notifications');
    if (!container) return;
    const notif = document.createElement('div');
    const uiId = gameStatus[teamId] ? gameStatus[teamId].uiId : 0;
    notif.className = `host-notif notif-${type} notif-team-${uiId}`;
    notif.innerHTML = `<span class="notif-team">${teamId}</span><span class="notif-text">${text}</span>`;
    container.appendChild(notif);
    setTimeout(() => { if (notif.parentNode) notif.remove(); }, 3500);
}

// ==========================================
// ANTI-PEGADO TIMEOUT
// ==========================================
function handleQuestionTimeout(teamId) {
    delete questionTimers[teamId];
    const ts = gameStatus[teamId];
    if (!ts) return;
    // Reset streak (they got stuck) but no score penalty
    ts.streak = 0;
    updateStreakDisplay();
    // Notify buzzer
    if (connections[teamId]) {
        connections[teamId].send({ type: 'TIMEOUT' });
    }
    // Epic notification on host
    showHostNotification('⚠️ ¡TIEMPO! ¡CAMBIO!', 'timeout', teamId);
    // Send new question after a brief delay
    setTimeout(() => { sendQuestionToTeam(teamId); }, 2500);
}

function showVictory(teamId, timeStr) {
    const vo = document.getElementById('victory-overlay');
    vo.classList.remove('hidden');
    vo.classList.add('active');
    document.getElementById('victory-text').innerText = '🎉 ¡VICTORIA! 🎉';
    document.getElementById('victory-team').innerText = `${teamId} gana en ${timeStr}`;
    launchConfetti();

    // Build post-race summary
    const summaryEl = document.getElementById('post-race-summary');
    if (summaryEl) {
        let html = '<div class="summary-grid">';
        for (let tId in gameStatus) {
            const ts = gameStatus[tId];
            const total = ts.score + ts.incorrect;
            const accuracy = total > 0 ? Math.round((ts.score / total) * 100) : 0;
            const avgTime = ts.score > 0 ? (ts.totalAnswerTimeMs / ts.score / 1000).toFixed(1) : '—';
            const isWinner = tId == teamId;
            html += `
                <div class="summary-card ${isWinner ? 'summary-winner' : ''} ${ts.uiId % 2 === 0 ? 'card-blue' : 'card-pink'}">
                    <div class="summary-team">${isWinner ? '🏆 ' : ''}${tId}</div>
                    <div class="summary-stats">
                        <div class="stat-row"><span class="stat-label">✅ Correctas</span><span class="stat-value">${ts.score}</span></div>
                        <div class="stat-row"><span class="stat-label">❌ Incorrectas</span><span class="stat-value">${ts.incorrect}</span></div>
                        <div class="stat-row"><span class="stat-label">🎯 Precisión</span><span class="stat-value">${accuracy}%</span></div>
                        <div class="stat-row"><span class="stat-label">🔥 Mejor racha</span><span class="stat-value">${ts.bestStreak}</span></div>
                        <div class="stat-row"><span class="stat-label">⚡ Turbos</span><span class="stat-value">${ts.turboCount}</span></div>
                        <div class="stat-row"><span class="stat-label">⏱️ Promedio</span><span class="stat-value">${avgTime}s</span></div>
                    </div>
                </div>`;
        }
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
    const teamInput = document.getElementById('team-selector').value.trim();

    if (code.length !== 4) { alert("El código debe tener 4 caracteres."); return; }
    if (!teamInput) { alert("Por favor ingresa tu nombre o avatar."); return; }

    const team = teamInput;
    buzzerTeamId = team;
    const hostPeerId = `mathrace-${code}`;
    peer = new Peer();

    peer.on('open', () => {
        currentConnection = peer.connect(hostPeerId, { metadata: { team: team } });

        currentConnection.on('open', () => {
            document.getElementById('join-section').classList.add('hidden');
            document.getElementById('gameplay-section').classList.remove('hidden');
            const th = document.getElementById('buzzer-team-name');
            th.innerText = `${team}`;
            th.className = `team-header team-blue-theme`;
        });

        currentConnection.on('data', (data) => {
            if (data.type === 'NEW_QUESTION') {
                document.getElementById('buzzer-question-display').innerText = data.text;
                clearNum();
                startBuzzerCountdown(data.timeLimit || QUESTION_TIMEOUT_S);
                // Switch between numpad and multiple-choice
                const numpad = document.getElementById('numpad-container');
                const optionsEl = document.getElementById('options-container');
                const answerBar = document.querySelector('.answer-bar');
                if (data.answerType === 'multiple-choice' && data.options) {
                    numpad.classList.add('hidden');
                    answerBar.classList.add('hidden');
                    optionsEl.classList.remove('hidden');
                    data.options.forEach((opt, i) => {
                        const el = document.getElementById(`opt-text-${i + 1}`);
                        if (el) el.innerText = opt;
                    });
                } else {
                    numpad.classList.remove('hidden');
                    answerBar.classList.remove('hidden');
                    optionsEl.classList.add('hidden');
                }
            }
            if (data.type === 'CORRECT') {
                stopBuzzerCountdown();
                showCorrectFlash();
                const th = document.getElementById('buzzer-team-name');
                let headerText = `${buzzerTeamId}`;

                // Show turbo flash
                if (data.turbo) {
                    headerText = `⚡ TURBO! +${data.points} ⚡`;
                    th.style.background = 'linear-gradient(90deg, #ff9100, #ffd700)';
                    th.style.color = '#000';
                    setTimeout(() => {
                        th.style.background = '';
                        th.style.color = '';
                    }, 1200);
                }

                // Show shield earned
                if (data.shieldEarned) {
                    setTimeout(() => {
                        th.innerText = '🛡️ ¡ESCUDO ACTIVADO! 🛡️';
                        th.style.background = 'linear-gradient(90deg, #00b4ff, #00e5ff)';
                        th.style.color = '#000';
                        setTimeout(() => {
                            th.style.background = '';
                            th.style.color = '';
                            th.innerText = `EQUIPO ${buzzerTeamId} 🛡️`;
                        }, 1500);
                    }, data.turbo ? 1300 : 0);
                }

                // Show streak + shield indicator
                if (data.streak && data.streak >= 2) {
                    let fires = '🔥';
                    if (data.streak >= 7) fires = '🔥🔥🔥';
                    else if (data.streak >= 5) fires = '🔥🔥';
                    headerText = `${buzzerTeamId} ${fires}×${data.streak}`;
                    if (data.hasShield) headerText += ' 🛡️';
                }

                if (!data.turbo && !data.shieldEarned) {
                    th.innerText = headerText;
                } else if (!data.shieldEarned) {
                    th.innerText = headerText;
                    setTimeout(() => {
                        let restoreText = `${buzzerTeamId}`;
                        if (data.streak >= 2) {
                            let f = '🔥';
                            if (data.streak >= 7) f = '🔥🔥🔥';
                            else if (data.streak >= 5) f = '🔥🔥';
                            restoreText += ` ${f}×${data.streak}`;
                        }
                        if (data.hasShield) restoreText += ' 🛡️';
                        th.innerText = restoreText;
                    }, 1200);
                }
            }
            if (data.type === 'SHIELD_USED') {
                stopBuzzerCountdown();
                // Shield blocked the freeze!
                const th = document.getElementById('buzzer-team-name');
                th.innerText = '🛡️ ¡ESCUDO USADO! ¡SALVADO! 🛡️';
                th.style.background = 'linear-gradient(90deg, #39ff14, #00e5ff)';
                th.style.color = '#000';
                setTimeout(() => {
                    th.style.background = '';
                    th.style.color = '';
                    th.innerText = `${buzzerTeamId}`;
                }, 2000);
            }
            if (data.type === 'FREEZE_PENALTY') {
                stopBuzzerCountdown();
                applyFreeze(data.seconds);
            }
            if (data.type === 'TIMEOUT') {
                stopBuzzerCountdown();
                clearNum();
                const tOverlay = document.getElementById('timeout-overlay');
                tOverlay.classList.remove('hidden');
                setTimeout(() => {
                    tOverlay.classList.add('hidden');
                }, 2500);
            }
            if (data.type === 'GAME_OVER') {
                stopBuzzerCountdown();
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

function submitOption(num) {
    if (!currentConnection) return;
    currentConnection.send({ type: 'ANSWER_SUBMIT', value: String(num) });
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

// ==========================================
// BUZZER COUNTDOWN TIMER
// ==========================================
let buzzerCountdownInterval = null;

function startBuzzerCountdown(seconds) {
    stopBuzzerCountdown();
    const container = document.getElementById('countdown-container');
    const bar = document.getElementById('countdown-bar');
    const urgentEl = document.getElementById('countdown-urgent');
    const numEl = document.getElementById('countdown-number');
    if (!container || !bar) return;

    container.classList.remove('hidden');
    urgentEl.classList.add('hidden');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    bar.className = 'countdown-fill';
    bar.offsetHeight; // force reflow
    bar.style.transition = `width ${seconds}s linear`;
    bar.style.width = '0%';

    let remaining = seconds;
    buzzerCountdownInterval = setInterval(() => {
        remaining--;
        if (remaining <= 15 && remaining > 0) {
            urgentEl.classList.remove('hidden');
            numEl.innerText = remaining;
        }
        if (remaining <= 10) {
            bar.classList.add('countdown-urgent');
            urgentEl.classList.remove('countdown-critical-num');
        }
        if (remaining <= 5) {
            bar.classList.add('countdown-critical');
            urgentEl.classList.add('countdown-critical-num');
        }
        if (remaining <= 0) {
            clearInterval(buzzerCountdownInterval);
            buzzerCountdownInterval = null;
        }
    }, 1000);
}

function stopBuzzerCountdown() {
    if (buzzerCountdownInterval) {
        clearInterval(buzzerCountdownInterval);
        buzzerCountdownInterval = null;
    }
    const container = document.getElementById('countdown-container');
    const bar = document.getElementById('countdown-bar');
    const urgentEl = document.getElementById('countdown-urgent');
    if (container) container.classList.add('hidden');
    if (bar) { bar.style.width = '100%'; bar.style.transition = 'none'; bar.className = 'countdown-fill'; }
    if (urgentEl) { urgentEl.classList.add('hidden'); urgentEl.classList.remove('countdown-critical-num'); }
}
