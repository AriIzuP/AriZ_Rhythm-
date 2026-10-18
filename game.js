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

  // Jarak waktu antara kemunculan not dan garis penilaian.
  const TRAVEL_TIME = 1.65;

  // Waktu toleransi penilaian, dalam detik.
  const WINDOWS = {
    perfect: 0.055,
    great: 0.105,
    good: 0.165,
    miss: 0.19
  };

  // Tempo demo. Ini belum tempo lagu original.
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
  let endTimeout = null;

  let activeHolds = new Map();

  // --------------------------------------------------
  // AUDIO DEMO
  // --------------------------------------------------

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        audioContext = new AudioContextClass();
      }
    }

    return audioContext;
  }

  function playTone(frequency, duration, volume, type) {
    if (!soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(
        frequency,
        ctx.currentTime
      );

      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + duration
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
    } catch (error) {
      // Game tetap bisa dimainkan tanpa suara.
    }
  }

  function playHitSound(grade) {
    const frequencies = {
      PERFECT: 880,
      GREAT: 660,
      GOOD: 440,
      MISS: 180
    };

    playTone(
      frequencies[grade] || 440,
      0.09,
      0.045,
      "sine"
    );
  }

  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;

    soundButton.textContent = soundEnabled ? "♫" : "♪";
    soundButton.style.opacity = soundEnabled ? "1" : "0.5";

    if (soundEnabled) {
      playTone(660, 0.08, 0.04, "sine");
    }
  });

  // --------------------------------------------------
  // CHART
  // --------------------------------------------------

  function buildChart() {
    const chart = [];

    // Pola chart demo yang dibuat secara lokal.
    // Waktu disimpan dalam detik.
    for (let beat = 2; beat < TOTAL_BEATS; beat++) {
      const time = beat * BEAT;

      if (beat % 8 === 7) {
        chart.push({
          id: "n" + chart.length,
          time,
          lane: beat % LANES,
          type: "flick",
          direction: beat % 2 === 0 ? 1 : -1,
          judged: false,
          spawned: false
        });
      } else if (beat % 8 === 3) {
        chart.push({
          id: "n" + chart.length,
          time,
          lane: (beat + 1) % LANES,
          type: "hold",
          duration: BEAT * 1.5,
          judged: false,
          spawned: false
        });
      } else {
        chart.push({
          id: "n" + chart.length,
          time,
          lane: (beat * 3 + Math.floor(beat / 4)) % LANES,
          type: "tap",
          judged: false,
          spawned: false
        });
      }

      // Not tambahan di sela ketukan.
      if (beat > 5 && beat % 4 === 1) {
        chart.push({
          id: "n" + chart.length,
          time: time + BEAT / 2,
          lane: (beat + 2) % LANES,
          type: "tap",
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

  // --------------------------------------------------
  // GAME START / STOP
  // --------------------------------------------------

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
    lastBeat = -1;

    notes = buildChart();
    noteElements.clear();
    notesLayer.replaceChildren();

    notes.forEach((note) => {
      note.judged = false;
      note.spawned = false;
    });

    updateStats();

    judgment.textContent = "GET READY!";
    judgment.style.color = "#45edff";
    statusLabel.textContent = "READY";

    highway.style.height = "";
    highway.scrollTop = 0;

    const ctx = getAudioContext();

    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }

    running = true;

    const now = performance.now();

    // Persiapan singkat sebelum chart berjalan.
    startTime = now + 1800;

    animationId = requestAnimationFrame(loop);
  }

  function stopGame() {
    running = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }

    if (endTimeout) {
      clearTimeout(endTimeout);
      endTimeout = null;
    }

    activeHolds.clear();
  }

  function returnToMenu() {
    stopGame();

    gameScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
  }

  // --------------------------------------------------
  // RENDER NOTES
  // --------------------------------------------------

  function spawnNote(note) {
    const element = document.createElement("div");

    element.className = "note " + note.type;
    element.dataset.id = note.id;

    // Pusat not berada di tengah jalur.
    element.style.left =
      ((note.lane + 0.5) / LANES * 100) + "%";

    if (note.type === "flick") {
      element.style.height = "19px";
    }

    if (note.type === "hold") {
      element.style.height = "15px";
    }

    notesLayer.appendChild(element);

    noteElements.set(note.id, element);
    note.spawned = true;
  }

  function renderNote(note, now) {
    const element = noteElements.get(note.id);

    if (!element) return;

    const height = highway.clientHeight;
    const hitY = height - 64;

    const elapsed = now - note.time;

    // 0 berarti not belum mencapai garis penilaian.
    const progress = 1 - elapsed / TRAVEL_TIME;

    const y = hitY - progress * (hitY + 30);

    element.style.top = y + "px";

    // Hilangkan not yang sudah terlalu jauh dari layar.
    if (y > height + 35) {
      element.remove();
      noteElements.delete(note.id);
    }
  }

  // --------------------------------------------------
  // GAME LOOP
  // --------------------------------------------------

  function loop(timestamp) {
    if (!running) return;

    const elapsed = (timestamp - startTime) / 1000;

    if (elapsed < 0) {
      judgment.textContent = "GET READY!";
      animationId = requestAnimationFrame(loop);
      return;
    }

    statusLabel.textContent = "PLAYING";

    // Ketukan visual untuk membantu pengujian.
    const beatNumber = Math.floor(elapsed / BEAT);

    if (beatNumber !== lastBeat && beatNumber >= 0) {
      lastBeat = beatNumber;
      playTone(110, 0.025, 0.012, "sine");
    }

    const height = highway.clientHeight;
    const hitY = height - 64;

    for (const note of notes) {
      if (note.judged) continue;

      const spawnTime = note.time - TRAVEL_TIME;

      if (!note.spawned && elapsed >= spawnTime) {
        spawnNote(note);
      }

      if (note.spawned) {
        renderNote(note, elapsed);
      }

      // Not yang melewati batas penilaian dianggap MISS.
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

  // --------------------------------------------------
  // JUDGMENT
  // --------------------------------------------------

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

    // Memicu ulang animasi efek.
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

    const accuracy = total > 0
      ? weighted / total
      : 100;

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
      return {
        note: nearest,
        distance: nearestDistance
      };
    }

    return null;
  }

  function gradeByDistance(distance) {
    if (distance <= WINDOWS.perfect) return "PERFECT";
    if (distance <= WINDOWS.great) return "GREAT";
    return "GOOD";
  }

  // --------------------------------------------------
  // TAP / HOLD / FLICK INPUT
  // --------------------------------------------------

  function currentElapsed() {
    return (performance.now() - startTime) / 1000;
  }

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

    // HOLD harus ditekan ketika not mencapai garis.
    if (note.type === "hold") {
      if (activeHolds.has(lane)) return;

      const grade = gradeByDistance(match.distance);

      activeHolds.set(lane, {
        note,
        startElapsed: elapsed,
        startGrade: grade
      });

      // Nilai HOLD ditentukan ketika penahanan selesai.
      return;
    }

    // TAP dan FLICK.
    const grade = gradeByDistance(match.distance);

    judgeNote(note, grade);

    if (event && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture tidak tersedia di semua browser.
      }
    }
  }

  function laneUp(lane, event) {
    if (event && event.cancelable) {
      event.preventDefault();
    }

    const hold = activeHolds.get(lane);

    if (!hold) return;

    activeHolds.delete(lane);

    const elapsed = currentElapsed();

    const expectedEnd =
      hold.note.time + hold.note.duration;

    const heldDuration =
      elapsed - hold.startElapsed;

    const requiredDuration =
      hold.note.duration * 0.7;

    // Pemain harus menahan tombol sampai hampir
    // seluruh durasi HOLD selesai.
    if (
      elapsed >= expectedEnd - 0.15 &&
      heldDuration >= requiredDuration
    ) {
      judgeNote(hold.note, hold.startGrade);
    } else {
      judgeNote(hold.note, "MISS");
    }
  }

  function laneFlick(lane, direction, event) {
    if (!running) return;

    if (event && event.cancelable) {
      event.preventDefault();
    }

    const elapsed = currentElapsed();

    if (elapsed < 0) return;

    const match = findNearestNote(lane, elapsed);

    if (!match) return;

    const note = match.note;

    if (note.type !== "flick") {
      // Gerakan cepat tidak menggantikan HOLD.
      if (note.type === "tap") {
        judgeNote(
          note,
          gradeByDistance(match.distance)
        );
      }

      return;
    }

    const grade = gradeByDistance(match.distance);

    // Chart demo menggunakan arah flick ke atas.
    // Gestur horizontal juga diterima untuk kemudahan
    // pengujian pada layar sentuh.
    judgeNote(note, grade);
  }

  // --------------------------------------------------
  // POINTER EVENTS
  // --------------------------------------------------

  let pointerStart = null;

  document.querySelectorAll(".lane-button").forEach((button) => {
    const lane = Number(button.dataset.lane);

    button.addEventListener("pointerdown", (event) => {
      pointerStart = {
        lane,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
        pointerId: event.pointerId
      };

      button.classList.add("active");

      laneDown(lane, event);
    });

    button.addEventListener("pointerup", (event) => {
      button.classList.remove("active");

      const start = pointerStart;

      if (
        start &&
        start.pointerId === event.pointerId
      ) {
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;

        const moved = Math.sqrt(dx * dx + dy * dy);

        if (moved > 22) {
          // Gestur bergerak cepat untuk FLICK.
          // Gerakan ke atas atau horizontal diterima.
          const direction =
            Math.abs(dx) > Math.abs(dy)
              ? Math.sign(dx)
              : -Math.sign(dy);

          laneFlick(lane, direction, event);
        }

        pointerStart = null;
      }

      laneUp(lane, event);
    });

    button.addEventListener("pointercancel", (event) => {
      button.classList.remove("active");
      laneUp(lane, event);
      pointerStart = null;
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  });

  // --------------------------------------------------
  // RESULT
  // --------------------------------------------------

  function finishGame() {
    if (!running) return;

    running = false;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = 0;
    }

    activeHolds.clear();

    // Catat MISS untuk HOLD yang belum selesai.
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

    const accuracy = total > 0
      ? weighted / total
      : 0;

    let rank = "C";

    if (accuracy >= 95) {
      rank = "S";
    } else if (accuracy >= 85) {
      rank = "A";
    } else if (accuracy >= 70) {
      rank = "B";
    }

    $("rank").textContent = rank;
    $("finalScore").textContent =
      String(score).padStart(6, "0");

    $("perfectCount").textContent = counts.PERFECT;
    $("greatCount").textContent = counts.GREAT;
    $("goodCount").textContent = counts.GOOD;
    $("missCount").textContent = counts.MISS;

    resultPanel.classList.remove("hidden");
  }

  // --------------------------------------------------
  // BUTTONS
  // --------------------------------------------------

  startButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", startGame);
  menuButton.addEventListener("click", returnToMenu);
  backButton.addEventListener("click", returnToMenu);

  // Mencegah halaman bergeser ketika bermain.
  highway.addEventListener("touchmove", (event) => {
    event.preventDefault();
  }, { passive: false });

})();
