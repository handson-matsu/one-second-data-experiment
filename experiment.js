/* Submission is independent of measurement timing, rendering and CSV export. */
(function (root) {
  'use strict';
  let fallbackSequence = 0;
  function sessionId() {
    try {
      if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    } catch { /* Try random bytes if UUID generation is unavailable. */ }
    const bytes = new Uint8Array(16);
    try {
      root.crypto.getRandomValues(bytes);
    } catch {
      // Last resort for older environments without Web Crypto.
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return `${Date.now().toString(36)}-${++fallbackSequence}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function createReporter(config) {
    let current = null;
    return {
      start(targetSeconds, plannedCount, feedbackMode) {
        current = {
          started_at: new Date().toISOString(),
          session_id: sessionId(),
          target_seconds: targetSeconds,
          planned_count: plannedCount,
          feedback_mode: feedbackMode,
          app_version: config.appVersion,
          schema_version: '1'
        };
      },
      reset() { current = null; },
      complete(values, completedAt) {
        if (!current || values.length !== current.planned_count) return;
        const metadata = current;
        // Consume before any network work: failures, redraws and resets never retry.
        current = null;
        if (!config.endpoint) return;
        try {
          const body = JSON.stringify({ ...metadata, completed_at: completedAt, measurements_ms: [...values] });
          // GAS reads JSON.parse(e.postData.contents). text/plain avoids preflight.
          // The opaque response intentionally does not control any participant UI.
          Promise.resolve(root.fetch(config.endpoint, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            credentials: 'omit',
            keepalive: true,
            body
          })).catch(() => {});
        } catch { /* Submission must never interrupt results or CSV export. */ }
      }
    };
  }
  root.ExperimentData = { createReporter };
})(typeof window !== 'undefined' ? window : globalThis);
