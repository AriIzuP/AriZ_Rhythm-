"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const menuScreen = $("menuScreen");
  const gameScreen = $("gameScreen");
  const startButton = $("startButton");
  const backButton = $("backButton");
  const retryButton = $("retryButton");
  const menuButton = $("menuButton");
  const soundButton = $("soundButton");

  const highway = $("highway");
  const notesLayer = $("notesLayer");
  const judgment = $("judgment");
  const hitEffect = $("hitEffect");
  const resultPanel = $("resultPanel");

  const scoreElement = $("score");
  const comboElement = $("combo");
  const accuracyElement = $("accuracy");
  const progressBar = $("progressBar");
  const statusLabel = $("statusLabel");

  const LANES = 4;
  const TRAVEL_TIME = 1.65;

  const WINDOWS = {
    perfect: 0.065,
    great: 0.12,
    good: 0.19,
    miss: 0.22
  };

  const BPM = 120;
  const BEAT = 60 / BPM;
  const TOTAL_BEATS = 64;
  const SONG_DURATION = TOTAL_BEATS * BEAT;

  let notes = [];
  let noteElements = new Map();

  let running = false;
  let startTime = 0;
  let animationId = 0;

  let score = 0;
  let combo = 0;
  let maxCombo = 0;

  let counts = {
    PERFECT: 0,
    GREAT: 0,
    GOOD: 0,
    MISS: 0
  };

  let audioContext = null;
  let soundEnabled = true;
  let lastBeat = -1;

  let activeHolds = new Map();
  let pointerStarts = new Map();

  // ---------------------------------------------
  // AUDIO
  // ---------------------------------------------

  function getAudioContext() {
    if (!audioContext) {
      const AudioClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioClass) {
        audioContext = new AudioClass();
      }
    }

    return audioContext;
  }

  function unlockAudio() {
    const ctx = getAudioContext();

    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    return ctx;
  }

  function playTone(frequency, duration, volume, type) {
    if (!soundEnabled) return;

    try {
      const ctx = unlockAudio();
      if (!ctx) return;

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type || "sine";

      oscillator.frequency.setValueAtTime(
        frequency,
        ctx.currentTime
      );

      gain.gain.setValueAtTime(
        Math.max(0.0001, volume),
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + duration
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
    } catch (error) {
      console.warn("Audio belum tersedia:", error);
    }
  }

  function playStartSound() {
    playTone(523, 0.12, 0.10, "sine");

    setTimeout(() => {
      if (soundEnabled) {
        playTone(784, 0.16, 0.10, "sine");
      }
    }, 130);
  }

  function playHitSound(grade) {
    const frequencies = {
      PERFECT: 1046,
      GREAT: 784,
      GOOD: 587,
      MISS: 220
    };

    const frequency = frequencies[grade] || 587;

    playTone(
      frequency,
      grade === "MISS" ? 0.13 : 0.10,
      0.12,
      "sine"
    );
  }

  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;

    soundButton.textContent = soundEnabled ? "♫" : "♪";
    soundButton.style.opacity = soundEnabled ? "1" : "0.5";

    if (soundEnabled) {
      unlockAudio();
      playStartSound();
    }
  });

  // ---------------------------------------------
  // CHART
  // ---------------------------------------------

  function buildChart() {
    const chart = [];

    for (let beat = 2; beat < TOTAL_BEATS; beat++) {
      const time = beat * BEAT;

      if (beat % 8 === 7) {
        chart.push({
          time,
          lane: beat % LANES,
          type: "flick",
          duration: 0,
          judged: false,
          spawned: false
        });
      } else if (beat % 8 === 3) {
        chart.push({
          time,
          lane: (beat + 1) % LANES,
          type: "hold",
          duration: BEAT * 1.5,
          judged: false,
          spawned: false
        });
      } else {
        chart.push({
          time,
          lane: (beat * 3 + Math.floor(beat / 4)) % LANES,
          type: "tap",
          duration: 0,
          judged: false,
          spawned: false
        });
      }

      if (beat > 5 && beat % 4 === 1) {
        chart.push({
          time: time + BEAT / 2,
          lane: (beat + 2) % LANES,
          type: "tap",
          duration: 0,
          judged: false,
          spawned: false
        });
      }
    }

    chart.sort((a, b) => a.time - b.time);

    chart.forEach((note, index) => {
      note.id = "note-" + index;
    });

    return chart;
  }

  // ---------------------------------------------
  // START / STOP
  // ---------------------------------------------

  function startGame() {
    stopGame();

    menuScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
    resultPanel.classList.add("hidden");

    score = 0;
    combo = 0;
    maxCombo = 0;

    counts = {
      PERFECT: 0,
      GREAT: 0,
      GOOD: 0,
      MISS: 0
    };

    activeHolds.clear();
    pointerStarts.clear();
    lastBeat = -1;

    notes = buildChart();
    noteElements.clear();
    notesLayer.replaceChildren();

    updateStats();

    judgment.textContent = "GET READY!";
    judgment.style.color = "#45edff";
    statusLabel.textContent = "READY";
    progressBar.style.width = "0%";

    unlockAudio();
    playStartSound();

    running = true;

    startTime = performance.now() + 1800;

    animationId = requestAnimationFrame(loop);
  }

  function stopGame() {
    running = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }

    activeHolds.clear();
    pointerStarts.clear();
  }

  function returnToMenu() {
    stopGame();

    gameScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
  }

  // ---------------------------------------------
  // NOTE RENDERING
  // ---------------------------------------------

  function spawnNote(note) {
    const element = document.createElement("div");

    element.className = "note " + note.type;
    element.dataset.id = note.id;

    element.style.left =
      ((note.lane + 0.5) / LANES * 100) + "%";

    if (note.type === "flick") {
      element.style.height = "19px";
    }

    notesLayer.appendChild(element);

    noteElements.set(note.id, element);
    note.spawned = true;
  }

  function renderNote(note, elapsed) {
    const element = noteElements.get(note.id);
    if (!element) return;

    const height = highway.clientHeight;
    const hitY = height - 42;

    /*
      FIX:
      Note mulai di atas layar dan turun menuju garis.
      Saat elapsed === note.time, posisi note tepat di hitY.
    */

    const spawnTime = note.time - TRAVEL_TIME;
    const progress = (elapsed - spawnTime) / TRAVEL_TIME;

    const startY = -24;
    const y = startY + progress * (hitY - startY);

    element.style.top = y + "px";

    // Jangan menghapus note sebelum penilaian MISS.
    if (y > height + 30 && note.judged) {
      element.remove();
      noteElements.delete(note.id);
    }
  }

  // ---------------------------------------------
  // GAME LOOP
  // ---------------------------------------------

  function loop(timestamp) {
    if (!running) return;

    const elapsed = (timestamp - startTime) / 1000;

    if (elapsed < 0) {
      judgment.textContent = "GET READY!";
      animationId = requestAnimationFrame(loop);
      return;
    }

    statusLabel.textContent = "PLAYING";

    const beatNumber = Math.floor(elapsed / BEAT);

    if (beatNumber !== lastBeat && beatNumber >= 0) {
      lastBeat = beatNumber;

      // Bunyi ketukan demo dibuat lebih terdengar.
      playTone(110, 0.045, 0.045, "sine");
    }

    for (const note of notes) {
      if (note.judged) continue;

      const spawnTime = note.time - TRAVEL_TIME;

      if (!note.spawned && elapsed >= spawnTime) {
        spawnNote(note);
      }

      if (note.spawned) {
        renderNote(note, elapsed);
      }

      if (elapsed > note.time + WINDOWS.miss) {
        judgeNote(note, "MISS");
      }
    }

    const progress = Math.min(
      100,
      Math.max(0, elapsed / SONG_DURATION * 100)
    );

    progressBar.style.width = progress + "%";

    if (elapsed >= SONG_DURATION + WINDOWS.miss + 0.3) {
      finishGame();
      return;
    }

    animationId = requestAnimationFrame(loop);
  }

  // ---------------------------------------------
  // JUDGMENT
  // ---------------------------------------------

  function removeNote(note) {
    const element = noteElements.get(note.id);

    if (element) {
      element.remove();
      noteElements.delete(note.id);
    }
  }

  function judgeNote(note, grade) {
    if (note.judged) return;

    note.judged = true;
    removeNote(note);

    counts[grade]++;

    if (grade === "MISS") {
      combo = 0;
      judgment.style.color = "#ff5577";
    } else {
      combo++;
      maxCombo = Math.max(maxCombo, combo);

      if (grade === "PERFECT") {
        score += 1000;
        judgment.style.color = "#45edff";
      } else if (grade === "GREAT") {
        score += 700;
        judgment.style.color = "#a68bff";
      } else {
        score += 400;
        judgment.style.color = "#ffb86b";
      }
    }

    judgment.textContent =
      combo > 1 && grade !== "MISS"
        ? grade + "  " + combo + " COMBO"
        : grade;

    playHitSound(grade);

    hitEffect.classList.remove("flash");
    void hitEffect.offsetWidth;
    hitEffect.classList.add("flash");

    updateStats();
  }

  function updateStats() {
    scoreElement.textContent = String(score).padStart(6, "0");
    comboElement.textContent = combo;

    const total =
      counts.PERFECT +
      counts.GREAT +
      counts.GOOD +
      counts.MISS;

    const weighted =
      counts.PERFECT * 100 +
      counts.GREAT * 70 +
      counts.GOOD * 40;

    const accuracy = total > 0 ? weighted / total : 100;

    accuracyElement.textContent = accuracy.toFixed(2) + "%";
  }

  function findNearestNote(lane, elapsed) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const note of notes) {
      if (note.judged || note.lane !== lane) continue;

      const distance = Math.abs(note.time - elapsed);

      if (distance < nearestDistance) {
        nearest = note;
        nearestDistance = distance;
      }
    }

    if (nearest && nearestDistance <= WINDOWS.miss) {
      return { note: nearest, distance: nearestDistance };
    }

    return null;
  }

  function gradeByDistance(distance) {
    if (distance <= WINDOWS.perfect) return "PERFECT";
    if (distance <= WINDOWS.great) return "GREAT";
    return "GOOD";
  }

  function currentElapsed() {
    return (performance.now() - startTime) / 1000;
  }

  // ---------------------------------------------
  // INPUT
  // ---------------------------------------------

  function laneDown(lane, event) {
    if (!running) return;

    if (event && event.cancelable) {
      event.preventDefault();
    }

    const elapsed = currentElapsed();
    if (elapsed < 0) return;

    const match = findNearestNote(lane, elapsed);
    if (!match) return;

    const note = match.note;

    if (note.type === "flick") {
      // Flick dinilai saat gerakan dilepaskan.
      return;
    }

    if (note.type === "hold") {
      if (activeHolds.has(lane)) return;

      activeHolds.set(lane, {
        note,
        startElapsed: elapsed,
        startGrade: gradeByDistance(match.distance)
      });

      return;
    }

    judgeNote(note, gradeByDistance(match.distance));
  }

  function laneUp(lane, event) {
    if (event && event.cancelable) {
      event.preventDefault();
    }

    const hold = activeHolds.get(lane);
    if (!hold) return;

    activeHolds.delete(lane);

    const elapsed = currentElapsed();
    const expectedEnd = hold.note.time + hold.note.duration;

    const heldDuration = elapsed - hold.startElapsed;
    const requiredDuration = hold.note.duration * 0.7;

    if (
      elapsed >= expectedEnd - 0.15 &&
      heldDuration >= requiredDuration
    ) {
      judgeNote(hold.note, hold.startGrade);
    } else {
      judgeNote(hold.note, "MISS");
    }
  }

  function laneFlick(lane, moved, event) {
    if (!running || !moved) return;

    if (event && event.cancelable) {
      event.preventDefault();
    }

    const elapsed = currentElapsed();
    if (elapsed < 0) return;

    const match = findNearestNote(lane, elapsed);
    if (!match) return;

    const note = match.note;

    if (note.type === "flick") {
      judgeNote(note, gradeByDistance(match.distance));
    } else if (note.type === "tap") {
      judgeNote(note, gradeByDistance(match.distance));
    }
  }

  document.querySelectorAll(".lane-button").forEach((button) => {
    const lane = Number(button.dataset.lane);

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();

      pointerStarts.set(event.pointerId, {
        lane,
        x: event.clientX,
        y: event.clientY
      });

      button.classList.add("active");
      laneDown(lane, event);
    });

    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      button.classList.remove("active");

      const start = pointerStarts.get(event.pointerId);

      if (start) {
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const moved = Math.sqrt(dx * dx + dy * dy) > 22;

        if (moved) {
          laneFlick(lane, true, event);
        }

        pointerStarts.delete(event.pointerId);
      }

      laneUp(lane, event);
    });

    button.addEventListener("pointercancel", (event) => {
      button.classList.remove("active");
      laneUp(lane, event);
      pointerStarts.delete(event.pointerId);
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  });

  // ---------------------------------------------
  // RESULTS
  // ---------------------------------------------

  function finishGame() {
    if (!running) return;

    running = false;
    activeHolds.clear();

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }

    for (const note of notes) {
      if (!note.judged) {
        judgeNote(note, "MISS");
      }
    }

    statusLabel.textContent = "FINISHED";

    const total =
      counts.PERFECT +
      counts.GREAT +
      counts.GOOD +
      counts.MISS;

    const weighted =
      counts.PERFECT * 100 +
      counts.GREAT * 70 +
      counts.GOOD * 40;

    const accuracy = total > 0 ? weighted / total : 0;

    let rank = "C";

    if (accuracy >= 95) {
      rank = "S";
    } else if (accuracy >= 85) {
      rank = "A";
    } else if (accuracy >= 70) {
      rank = "B";
    }

    $("rank").textContent = rank;
    $("finalScore").textContent = String(score).padStart(6, "0");

    $("perfectCount").textContent = counts.PERFECT;
    $("greatCount").textContent = counts.GREAT;
    $("goodCount").textContent = counts.GOOD;
    $("missCount").textContent = counts.MISS;

    resultPanel.classList.remove("hidden");
  }

  // ---------------------------------------------
  // BUTTONS
  // ---------------------------------------------

  startButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", startGame);
  menuButton.addEventListener("click", returnToMenu);
  backButton.addEventListener("click", returnToMenu);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) {
      // Tidak menghentikan permainan otomatis,
      // tetapi mencegah suara tertinggal saat kembali.
      const ctx = getAudioContext();

      if (ctx && ctx.state === "running") {
        ctx.suspend().catch(() => {});
      }
    } else if (!document.hidden && running) {
      unlockAudio();
    }
  });
})();
