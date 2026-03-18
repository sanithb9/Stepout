/* ============================================================
   drywindow.js – The core dry-window algorithm
   Analyzes precipitation timeline and scores candidate windows
   ============================================================ */

const DryWindow = (() => {

  // --- Sarcastic messages by quality ---
  const MESSAGES = {
    excellent: [
      "Perfect conditions. No excuses now.",
      "The sky is basically begging you to go outside.",
      "Mother Nature is clearly rooting for you.",
      "This is as good as it gets. Lace up.",
      "Meteorologically speaking: get out there.",
    ],
    good: [
      "Not bad. A light jacket might help.",
      "Decent window. The clouds are taking a break.",
      "Good enough to pretend you enjoy outdoors.",
      "You've earned this gap. Make it count.",
      "Slightly overcast, but your umbrella can stay home.",
    ],
    fair: [
      "It's dryish. Dress accordingly.",
      "The rain is resting. Temporarily.",
      "Not ideal, but humans have survived worse.",
      "Clouds are lurking, but not doing anything yet.",
      "Fair window. Lower your expectations slightly.",
    ],
    minimal: [
      "You've got a narrow gap. Use it or lose it.",
      "Barely dry, but that's the best we've got.",
      "The weather is being difficult. Aren't we all.",
      "A small window of opportunity. Literally.",
      "Look, it's not raining RIGHT NOW. That's something.",
    ],
  };

  function pickMessage(score, i18n) {
    let bucket;
    if (score >= 7.5) bucket = 'excellent';
    else if (score >= 5.5) bucket = 'good';
    else if (score >= 3.5) bucket = 'fair';
    else bucket = 'minimal';

    const msgs = MESSAGES[bucket];
    const idx = Math.floor(Math.random() * msgs.length);
    return msgs[idx];
  }

  /**
   * Score a candidate window (0–10).
   * Higher = better outdoor conditions.
   */
  function scoreWindow(intervals) {
    if (!intervals.length) return 0;

    const avgCloud = intervals.reduce((s, i) => s + (i.cloudCover || 0), 0) / intervals.length;
    const avgWind = intervals.reduce((s, i) => s + (i.windSpeed || 0), 0) / intervals.length;
    const maxPrecip = Math.max(...intervals.map(i => i.precip || 0));
    const avgUV = intervals.reduce((s, i) => s + (i.uvIndex || 0), 0) / intervals.length;

    // Cloud penalty (0–10, lower is better)
    const cloudScore = Math.max(0, 10 - (avgCloud / 10));

    // Wind penalty
    const windScore = avgWind < 15 ? 10 : avgWind < 30 ? 7 : avgWind < 50 ? 4 : 1;

    // Precipitation penalty (anything > 0 loses hard)
    const precipScore = maxPrecip === 0 ? 10 : maxPrecip < 0.1 ? 6 : 2;

    // UV bonus (nice sunlight = +points, but UV > 8 = penalty)
    const uvScore = avgUV < 3 ? 7 : avgUV < 6 ? 10 : avgUV < 9 ? 8 : 5;

    const score = (cloudScore * 0.35) + (windScore * 0.25) + (precipScore * 0.3) + (uvScore * 0.1);
    return Math.round(score * 10) / 10;
  }

  /**
   * Main algorithm.
   *
   * @param {Array} minutely15 – Array of 15-min intervals with { time, precip, windSpeed, cloudCover, uvIndex? }
   * @param {number} minMinutes – Minimum dry window duration in minutes (default 10)
   * @returns {Object|null} Best window descriptor or null
   */
  function findDryWindow(minutely15, minMinutes = 10) {
    if (!minutely15 || minutely15.length === 0) return null;

    const SLOT_MINUTES = 15;

    // Step 1: Identify dry intervals (precip = 0 or negligible < 0.05 mm)
    const intervals = minutely15.map(slot => ({
      ...slot,
      isDry: (slot.precip ?? 0) < 0.05,
    }));

    // Step 2: Group consecutive dry slots into windows
    const windows = [];
    let currentWindow = null;

    for (const interval of intervals) {
      if (interval.isDry) {
        if (!currentWindow) {
          currentWindow = { intervals: [interval], start: interval.time };
        } else {
          currentWindow.intervals.push(interval);
        }
      } else {
        if (currentWindow) {
          currentWindow.end = currentWindow.intervals[currentWindow.intervals.length - 1].time;
          windows.push(currentWindow);
          currentWindow = null;
        }
      }
    }
    if (currentWindow) {
      currentWindow.end = currentWindow.intervals[currentWindow.intervals.length - 1].time;
      windows.push(currentWindow);
    }

    // Step 3: Filter to windows >= minMinutes
    const minSlots = Math.ceil(minMinutes / SLOT_MINUTES);
    const validWindows = windows.filter(w => w.intervals.length >= minSlots);

    if (validWindows.length === 0) return null;

    // Step 4: Score and pick the best
    const scored = validWindows.map(w => ({
      ...w,
      durationMinutes: w.intervals.length * SLOT_MINUTES,
      score: scoreWindow(w.intervals),
    }));

    // Sort: prefer earlier high-score windows (within next 90 min), then by score
    scored.sort((a, b) => {
      const aStart = new Date(a.start).getTime();
      const bStart = new Date(b.start).getTime();
      const now = Date.now();
      const aIsNear = aStart - now < 90 * 60000;
      const bIsNear = bStart - now < 90 * 60000;

      if (aIsNear && !bIsNear) return -1;
      if (!aIsNear && bIsNear) return 1;

      // Both near: prefer higher score
      if (Math.abs(a.score - b.score) > 1) return b.score - a.score;

      // Similar score: prefer earlier
      return aStart - bStart;
    });

    const best = scored[0];

    // Compute window time values
    const startTime = new Date(best.start);
    const endTime = new Date(startTime.getTime() + best.durationMinutes * 60000);

    // Aggregate window conditions
    const avgCloud = Math.round(
      best.intervals.reduce((s, i) => s + (i.cloudCover || 0), 0) / best.intervals.length
    );
    const avgWind = Math.round(
      best.intervals.reduce((s, i) => s + (i.windSpeed || 0), 0) / best.intervals.length
    );

    const message = pickMessage(best.score);

    return {
      startTime,
      endTime,
      durationMinutes: best.durationMinutes,
      score: best.score,
      cloudCover: avgCloud,
      windSpeed: avgWind,
      message,
      intervals: best.intervals,
      allWindows: scored,
    };
  }

  /**
   * Format a window for display, honouring locale
   */
  function formatWindow(window, locale = 'en') {
    if (!window) return null;

    const timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false };
    const startStr = window.startTime.toLocaleTimeString(locale, timeOpts);
    const endStr = window.endTime.toLocaleTimeString(locale, timeOpts);

    // Minutes until window starts
    const msUntil = window.startTime.getTime() - Date.now();
    const minutesUntil = Math.round(msUntil / 60000);

    let countdownText = null;
    if (minutesUntil <= 0) {
      countdownText = 'Starting now!';
    } else if (minutesUntil < 60) {
      countdownText = `Starts in ${minutesUntil} min`;
    } else {
      const h = Math.floor(minutesUntil / 60);
      const m = minutesUntil % 60;
      countdownText = `Starts in ${h}h ${m > 0 ? m + 'm' : ''}`;
    }

    const scoreClass = window.score >= 7.5 ? 'score-high'
      : window.score >= 5 ? 'score-mid'
      : 'score-low';

    return {
      startStr,
      endStr,
      durationMinutes: window.durationMinutes,
      score: window.score,
      scoreDisplay: `${window.score}/10`,
      scoreClass,
      cloudCover: window.cloudCover,
      windSpeed: window.windSpeed,
      message: window.message,
      countdownText,
      minutesUntil,
    };
  }

  return { findDryWindow, formatWindow, scoreWindow };
})();

window.DryWindow = DryWindow;
