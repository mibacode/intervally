// Core configurations and presets definitions
const defaultPresets = [
  {
    id: 'preset-tabata',
    name: 'Classic Tabata',
    warmupDuration: 10,
    beepInterval: 20,
    beepCountTarget: 1,
    beepDuration: 0.1,
    pauseDuration: 10,
    iterationTarget: 8,
    isDefault: true
  },
  {
    id: 'preset-boxing',
    name: 'Boxing Rounds',
    warmupDuration: 15,
    beepInterval: 60,
    beepCountTarget: 3,
    beepDuration: 0.15,
    pauseDuration: 60,
    iterationTarget: 12,
    isDefault: true
  },
  {
    id: 'preset-hiit-nested',
    name: 'Nested HIIT Sprint',
    warmupDuration: 10,
    beepInterval: 5,
    beepCountTarget: 6, // 30 seconds total work round
    beepDuration: 0.08,
    pauseDuration: 15, // 15 seconds rest
    iterationTarget: 8,
    isDefault: true
  },
  {
    id: 'preset-beep-test',
    name: 'Beep Test Run',
    warmupDuration: 10,
    beepInterval: 8,
    beepCountTarget: 10, // 80s of running per level
    beepDuration: 0.1,
    pauseDuration: 30, // 30s rest between levels
    iterationTarget: 5,
    isDefault: true
  }
];

let customPresets = [];
let timerConfig = {
  warmupDuration: 5,
  beepDuration: 0.1,
  beepInterval: 5,
  beepCountTarget: 10,
  pauseDuration: 60,
  iterationTarget: 3,
  voiceEnabled: true,
  soundEnabled: true
};

const timerRunState = {
  running: false,
  paused: false
};

// Global variables for executing states
let segments = [];
let currentIndex = 0;
let segmentEndTime = 0;
let totalWorkoutDuration = 0;
let savedRemainingTime = 0;
let animationFrameId = null;

// Hardware Integrations
let audioCtx = null;
let wakeLock = null;

// Initialize Audio Context on user action
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

// Low-level pitch generator (avoid clicking sounds using smooth envelopes)
function playTone(frequency, duration, startTime) {
  if (!timerConfig.soundEnabled) return;
  initAudio();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.frequency.setValueAtTime(frequency, startTime);
  osc.type = 'sine';

  gain.gain.setValueAtTime(0.15, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

// Text to Speech
function speak(text) {
  if (!timerConfig.voiceEnabled) return;
  try {
    window.speechSynthesis.cancel(); // Stop any pending cues
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error("Speech synthesis failed:", err);
  }
}

// Screen Wake Lock API
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      updateWakeLockUI(true);
      wakeLock.addEventListener('release', () => {
        updateWakeLockUI(false);
      });
    } catch (err) {
      console.error(`Wake lock acquisition failed: ${err.name}, ${err.message}`);
      updateWakeLockUI(false);
    }
  } else {
    updateWakeLockUI(false, "Lock Unsupported");
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release();
    wakeLock = null;
    updateWakeLockUI(false);
  }
}

function updateWakeLockUI(active, infoText = "") {
  const dot = document.getElementById('wakelock-dot');
  const txt = document.getElementById('wakelock-txt');
  if (active) {
    dot.classList.add('active');
    txt.textContent = "Screen Wake Lock Active";
  } else {
    dot.classList.remove('active');
    txt.textContent = infoText || "Screen Wake Lock Inactive";
  }
}

// Re-request wake lock when regaining window focus
document.addEventListener('visibilitychange', async () => {
  if (timerRunState.running && !timerRunState.paused && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// View navigation helper
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

// Screen visual flash on beep ticks
function triggerFlash() {
  const overlay = document.getElementById('flash-overlay');
  overlay.classList.add('flash-active');
  setTimeout(() => {
    overlay.classList.remove('flash-active');
  }, 100);
}

// Time Format helpers
function formatCountdown(totalSeconds) {
  const rounded = Math.ceil(totalSeconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatMinutes(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

function calculateTotalDuration(config) {
  let total = 0;
  total += config.warmupDuration;
  const workRound = config.beepInterval * config.beepCountTarget;
  const totalWork = workRound * config.iterationTarget;
  const totalRest = config.pauseDuration * (config.iterationTarget - 1);
  total += totalWork + totalRest;
  return total;
}

// Steppers Configuration Interface
function applyBounds(param) {
  if (param === 'warmupDuration') {
    if (timerConfig.warmupDuration < 0) timerConfig.warmupDuration = 0;
    if (timerConfig.warmupDuration > 300) timerConfig.warmupDuration = 300;
  } else if (param === 'beepInterval') {
    if (timerConfig.beepInterval < 1) timerConfig.beepInterval = 1;
    if (timerConfig.beepInterval > 3600) timerConfig.beepInterval = 3600;
  } else if (param === 'beepCountTarget') {
    if (timerConfig.beepCountTarget < 1) timerConfig.beepCountTarget = 1;
    if (timerConfig.beepCountTarget > 100) timerConfig.beepCountTarget = 100;
  } else if (param === 'beepDuration') {
    if (timerConfig.beepDuration < 0.05) timerConfig.beepDuration = 0.05;
    if (timerConfig.beepDuration > 2.0) timerConfig.beepDuration = 2.0;
  } else if (param === 'pauseDuration') {
    if (timerConfig.pauseDuration < 0) timerConfig.pauseDuration = 0;
    if (timerConfig.pauseDuration > 3600) timerConfig.pauseDuration = 3600;
  } else if (param === 'iterationTarget') {
    if (timerConfig.iterationTarget < 1) timerConfig.iterationTarget = 1;
    if (timerConfig.iterationTarget > 50) timerConfig.iterationTarget = 50;
  }
}

function updateStepperUI() {
  document.getElementById('val-warmupDuration').textContent = `${timerConfig.warmupDuration}s`;
  document.getElementById('val-beepInterval').textContent = `${timerConfig.beepInterval}s`;
  document.getElementById('val-beepCountTarget').textContent = timerConfig.beepCountTarget;
  document.getElementById('val-beepDuration').textContent = `${timerConfig.beepDuration}s`;
  document.getElementById('val-pauseDuration').textContent = `${timerConfig.pauseDuration}s`;
  document.getElementById('val-iterationTarget').textContent = timerConfig.iterationTarget;

  const totalSecs = calculateTotalDuration(timerConfig);
  const startBtn = document.getElementById('start-btn');
  startBtn.innerHTML = `
    <svg viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: currentColor; margin-right: 8px;">
      <path d="M8 5v14l11-7z"/>
    </svg>
    Start Workout (${formatMinutes(totalSecs)})
  `;
}

function saveCurrentConfigToStorage() {
  localStorage.setItem('intervally_config', JSON.stringify(timerConfig));
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  localStorage.removeItem('intervally_selected_preset_id');
}

// Steppers Event Listeners
document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const param = btn.getAttribute('data-param');
    const step = parseFloat(btn.getAttribute('data-step'));
    timerConfig[param] = parseFloat((timerConfig[param] + step).toFixed(2));
    applyBounds(param);
    updateStepperUI();
    saveCurrentConfigToStorage();
  });
});

// Presets Rendering and Selection
function loadPresets() {
  const stored = localStorage.getItem('intervally_custom_presets');
  if (stored) {
    try {
      customPresets = JSON.parse(stored);
    } catch (e) {
      customPresets = [];
    }
  }
  renderPresetChips();
}

function renderPresetChips() {
  const container = document.getElementById('presets-list');
  container.innerHTML = '';

  const allPresets = [...defaultPresets, ...customPresets];
  allPresets.forEach(preset => {
    const chip = document.createElement('div');
    chip.className = 'preset-chip';
    chip.id = `preset-chip-${preset.id}`;

    const totalTime = calculateTotalDuration(preset);
    const formatted = formatMinutes(totalTime);

    chip.innerHTML = `
      <div class="preset-info">
        <div class="preset-name">${preset.name}</div>
        <div class="preset-desc">${preset.iterationTarget} r &bull; ${formatted}</div>
      </div>
    `;

    if (!preset.isDefault) {
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-preset-btn';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCustomPreset(preset.id);
      });
      chip.appendChild(delBtn);
    }

    chip.addEventListener('click', () => selectPreset(preset.id));
    container.appendChild(chip);
  });
}

function selectPreset(id) {
  const allPresets = [...defaultPresets, ...customPresets];
  const selected = allPresets.find(p => p.id === id);
  if (selected) {
    timerConfig.warmupDuration = selected.warmupDuration;
    timerConfig.beepInterval = selected.beepInterval;
    timerConfig.beepCountTarget = selected.beepCountTarget;
    timerConfig.beepDuration = selected.beepDuration;
    timerConfig.pauseDuration = selected.pauseDuration;
    timerConfig.iterationTarget = selected.iterationTarget;

    updateStepperUI();

    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.getElementById(`preset-chip-${id}`);
    if (activeChip) activeChip.classList.add('active');

    localStorage.setItem('intervally_selected_preset_id', id);
  }
}

function saveCustomPreset(name) {
  const newPreset = {
    id: 'custom-' + Date.now(),
    name: name,
    warmupDuration: timerConfig.warmupDuration,
    beepInterval: timerConfig.beepInterval,
    beepCountTarget: timerConfig.beepCountTarget,
    beepDuration: timerConfig.beepDuration,
    pauseDuration: timerConfig.pauseDuration,
    iterationTarget: timerConfig.iterationTarget,
    isDefault: false
  };
  customPresets.push(newPreset);
  localStorage.setItem('intervally_custom_presets', JSON.stringify(customPresets));
  renderPresetChips();
  selectPreset(newPreset.id);
}

function deleteCustomPreset(id) {
  customPresets = customPresets.filter(p => p.id !== id);
  localStorage.setItem('intervally_custom_presets', JSON.stringify(customPresets));
  renderPresetChips();
  
  // Clean active selection if current was deleted
  const currentSelectedId = localStorage.getItem('intervally_selected_preset_id');
  if (currentSelectedId === id) {
    localStorage.removeItem('intervally_selected_preset_id');
    updateStepperUI();
  }
}

// Preset Modal logic
const modal = document.getElementById('preset-modal');
const modalInput = document.getElementById('preset-name-input');

document.getElementById('save-preset-btn').addEventListener('click', () => {
  modal.classList.add('active');
  modalInput.value = '';
  modalInput.focus();
});

document.getElementById('modal-cancel-btn').addEventListener('click', () => {
  modal.classList.remove('active');
});

document.getElementById('modal-save-btn').addEventListener('click', () => {
  const name = modalInput.value.trim();
  if (name) {
    saveCustomPreset(name);
    modal.classList.remove('active');
  } else {
    modalInput.style.borderColor = 'var(--accent-crimson)';
    setTimeout(() => { modalInput.style.borderColor = 'var(--border-glass)'; }, 1000);
  }
});

// Sound / Speech Settings Binders
const voiceBtn = document.getElementById('voice-toggle');
const soundBtn = document.getElementById('sound-toggle');

voiceBtn.addEventListener('click', () => {
  timerConfig.voiceEnabled = !timerConfig.voiceEnabled;
  voiceBtn.classList.toggle('muted', !timerConfig.voiceEnabled);
  localStorage.setItem('intervally_config', JSON.stringify(timerConfig));
  if (timerConfig.voiceEnabled) speak("Voice enabled");
});

soundBtn.addEventListener('click', () => {
  timerConfig.soundEnabled = !timerConfig.soundEnabled;
  soundBtn.classList.toggle('muted', !timerConfig.soundEnabled);
  localStorage.setItem('intervally_config', JSON.stringify(timerConfig));
  if (timerConfig.soundEnabled) playTone(880, 0.1, audioCtx ? audioCtx.currentTime : 0);
});

// WORKOUT RUNNER ENGINE
function buildTimelineUI() {
  const bar = document.getElementById('timeline-bar');
  bar.innerHTML = '';

  segments.forEach((seg, idx) => {
    const chip = document.createElement('div');
    chip.className = `timeline-segment ${seg.type.toLowerCase()}`;
    const pct = (seg.duration / totalWorkoutDuration) * 100;
    chip.style.width = `${pct}%`;
    chip.id = `timeline-seg-${idx}`;
    bar.appendChild(chip);
  });
}

function highlightTimelineSegment(currIdx) {
  segments.forEach((_, idx) => {
    const el = document.getElementById(`timeline-seg-${idx}`);
    if (el) {
      if (idx === currIdx) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });
}

function startSegment(idx) {
  currentIndex = idx;
  const seg = segments[idx];
  segmentEndTime = performance.now() + (seg.duration * 1000);

  let accent = 'var(--accent-cyan)';
  let glow = 'rgba(0, 240, 255, 0.25)';
  let stateTxt = 'WARMUP';
  let speech = '';

  if (seg.type === 'WARMUP') {
    accent = 'var(--accent-cyan)';
    glow = 'rgba(0, 240, 255, 0.25)';
    stateTxt = 'GET READY';
    playTone(600, 0.08, audioCtx.currentTime);
  } else if (seg.type === 'WORK') {
    accent = 'var(--accent-orange)';
    glow = 'rgba(255, 122, 69, 0.25)';
    stateTxt = `WORK ${seg.beepIndex} / ${timerConfig.beepCountTarget}`;
    playTone(880, timerConfig.beepDuration, audioCtx.currentTime);
  } else if (seg.type === 'REST') {
    accent = 'var(--accent-emerald)';
    glow = 'rgba(0, 230, 118, 0.25)';
    stateTxt = 'RESTING';
    speech = 'Rest';
    
    // Play dual tones
    const now = audioCtx.currentTime;
    playTone(554.37, 0.15, now);
    playTone(440.00, 0.25, now + 0.12);
  }

  // Update styles and labels
  document.documentElement.style.setProperty('--theme-accent', accent);
  document.documentElement.style.setProperty('--theme-accent-glow', glow);
  document.getElementById('timer-state').textContent = stateTxt;
  document.getElementById('timer-iteration').textContent = `Round ${seg.iteration} / ${timerConfig.iterationTarget}`;

  const beepsLabel = document.getElementById('detail-beep-count');
  beepsLabel.textContent = seg.type === 'WORK' ? `${seg.beepIndex} / ${timerConfig.beepCountTarget}` : '--';

  speak(speech);
  triggerFlash();
  highlightTimelineSegment(idx);
}

function clockLoop() {
  if (!timerRunState.running || timerRunState.paused) return;

  const now = performance.now();
  const seg = segments[currentIndex];
  const remaining = Math.max(0, (segmentEndTime - now) / 1000);

  if (now >= segmentEndTime) {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= segments.length) {
      endWorkout(true);
      return;
    } else {
      startSegment(nextIdx);
    }
  } else {
    // Update display timer
    document.getElementById('timer-time').textContent = formatCountdown(remaining);

    // Update Progress Ring
    const progressCircle = document.getElementById('progress-circle');
    const ratio = Math.max(0, Math.min(1, remaining / seg.duration));
    const offset = 754 * (1 - ratio);
    progressCircle.style.strokeDashoffset = offset;

    // Update total workout left duration
    let remainingTotal = remaining;
    for (let i = currentIndex + 1; i < segments.length; i++) {
      remainingTotal += segments[i].duration;
    }
    document.getElementById('detail-total-left').textContent = formatCountdown(remainingTotal);
  }

  animationFrameId = requestAnimationFrame(clockLoop);
}

function startWorkout() {
  initAudio();
  
  // Re-enable and unlock speech synthesis for Safari / Mobile Chrome
  speak("");

  // Compile timeline segments
  segments = [];
  if (timerConfig.warmupDuration > 0) {
    segments.push({ type: 'WARMUP', duration: timerConfig.warmupDuration, iteration: 1, beepIndex: 0 });
  }

  for (let r = 1; r <= timerConfig.iterationTarget; r++) {
    for (let b = 1; b <= timerConfig.beepCountTarget; b++) {
      segments.push({ type: 'WORK', duration: timerConfig.beepInterval, iteration: r, beepIndex: b });
    }
    if (r < timerConfig.iterationTarget && timerConfig.pauseDuration > 0) {
      segments.push({ type: 'REST', duration: timerConfig.pauseDuration, iteration: r, beepIndex: 0 });
    }
  }

  totalWorkoutDuration = calculateTotalDuration(timerConfig);

  buildTimelineUI();
  showView('active-view');
  requestWakeLock();

  timerRunState.running = true;
  timerRunState.paused = false;

  // Reset controls
  document.getElementById('pause-icon').style.display = 'block';
  document.getElementById('resume-icon').style.display = 'none';

  startSegment(0);
  clockLoop();
}

function togglePause() {
  if (!timerRunState.running) return;

  if (!timerRunState.paused) {
    // Pause
    timerRunState.paused = true;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    savedRemainingTime = segmentEndTime - performance.now();
    
    document.getElementById('pause-icon').style.display = 'none';
    document.getElementById('resume-icon').style.display = 'block';
    
    releaseWakeLock();
    speak("Paused");
  } else {
    // Resume
    timerRunState.paused = false;
    segmentEndTime = performance.now() + savedRemainingTime;

    document.getElementById('pause-icon').style.display = 'block';
    document.getElementById('resume-icon').style.display = 'none';

    requestWakeLock();
    speak("Resuming");
    clockLoop();
  }
}

function endWorkout(completed = false) {
  timerRunState.running = false;
  timerRunState.paused = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  releaseWakeLock();

  if (completed) {
    // Play celebratory tone arpeggio
    const now = audioCtx.currentTime;
    playTone(523.25, 0.15, now);
    playTone(659.25, 0.15, now + 0.12);
    playTone(783.99, 0.15, now + 0.24);
    playTone(1046.50, 0.35, now + 0.36);

    speak("Workout complete. Outstanding job!");

    // Build completion summary report
    const beepCountTotal = timerConfig.iterationTarget * timerConfig.beepCountTarget;
    const workoutTimeFormatted = formatMinutes(totalWorkoutDuration);
    
    document.getElementById('completion-summary').innerHTML = `
      Great work! You completed <strong>${timerConfig.iterationTarget} rounds</strong>, hearing 
      <strong>${beepCountTotal} work beep ticks</strong> over a total duration of 
      <strong>${workoutTimeFormatted}</strong>.
    `;
    showView('completion-view');
  } else {
    // Cancelled / Reset
    document.documentElement.style.setProperty('--theme-accent', 'var(--accent-cyan)');
    document.documentElement.style.setProperty('--theme-accent-glow', 'rgba(0, 240, 255, 0.25)');
    showView('config-view');
  }
}

// Global button triggers
document.getElementById('start-btn').addEventListener('click', startWorkout);
document.getElementById('pause-btn').addEventListener('click', togglePause);
document.getElementById('stop-btn').addEventListener('click', () => endWorkout(false));
document.getElementById('back-btn').addEventListener('click', () => {
  document.documentElement.style.setProperty('--theme-accent', 'var(--accent-cyan)');
  document.documentElement.style.setProperty('--theme-accent-glow', 'rgba(0, 240, 255, 0.25)');
  showView('config-view');
});

// App Startup Initializer
function init() {
  // Load saved preferences if any
  const saved = localStorage.getItem('intervally_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      timerConfig = { ...timerConfig, ...parsed };
    } catch (e) {}
  }

  loadPresets();

  const selectedPresetId = localStorage.getItem('intervally_selected_preset_id');
  if (selectedPresetId) {
    selectPreset(selectedPresetId);
  } else {
    updateStepperUI();
  }

  // Set initial toggles status visual state
  document.getElementById('voice-toggle').classList.toggle('muted', !timerConfig.voiceEnabled);
  document.getElementById('sound-toggle').classList.toggle('muted', !timerConfig.soundEnabled);
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered with scope: ', reg.scope))
      .catch(err => console.error('Service Worker registration failed: ', err));
  });
}

// Run boot sequence
init();
