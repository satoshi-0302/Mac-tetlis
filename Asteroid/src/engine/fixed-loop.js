export function createFixedLoop({ stepHz, update, render }) {
  const fixedStep = 1 / stepHz;
  let running = false;
  let lastFrameTime = 0;
  let accumulator = 0;
  let rafId = 0;

  function frame(nowMs) {
    if (!running) {
      return;
    }

    if (lastFrameTime === 0) {
      lastFrameTime = nowMs;
    }

    let deltaSeconds = (nowMs - lastFrameTime) / 1000;
    lastFrameTime = nowMs;
    deltaSeconds = Math.min(deltaSeconds, 0.25);
    accumulator += deltaSeconds;

    while (accumulator >= fixedStep) {
      update();
      accumulator -= fixedStep;
    }

    render(accumulator / fixedStep);
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      lastFrameTime = 0;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    isRunning() {
      return running;
    }
  };
}
