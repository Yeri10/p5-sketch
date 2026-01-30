// Agent.js
// Uses global variables defined in sketch.js: agentAlpha

class Agent {
  constructor(noiseZRange) {
    // position
    this.vector = createVector(random(width), random(height));
    this.vectorOld = this.vector.copy();

    // physics (Euler integration)
    this.vel = p5.Vector.random2D().mult(random(0.2, 0.6));
    this.acc = createVector(0, 0);

    // visual / motion params
    this.stepSize = random(1, 5); // used as a visual thickness multiplier
    this.maxSpeed = 5;           // cap for stability

    // flow-field
    this.angle = 0;
    this.noiseZ = random(noiseZRange);
  }

  // Add a force into acceleration
  applyForce(f) {
    if (!f) return;
    this.acc.add(f);
  }

  // Wrap around edges (keeps trails continuous)
  wrap() {
    if (this.vector.x < -10) this.vector.x = this.vectorOld.x = width + 10;
    if (this.vector.x > width + 10) this.vector.x = this.vectorOld.x = -10;
    if (this.vector.y < -10) this.vector.y = this.vectorOld.y = height + 10;
    if (this.vector.y > height + 10) this.vector.y = this.vectorOld.y = -10;
  }

  // Euler integration + damping (drag)
  integrate(drag = 0.5) {
    // v = v + a
    this.vel.add(this.acc);

    // damping: v = v * (1 - drag)
    this.vel.mult(1 - drag);

    // speed cap
    this.vel.limit(this.maxSpeed);

    // x = x + v
    this.vector.add(this.vel);

    // reset acceleration
    this.acc.mult(0);
  }

  // Draw trail line from previous to current position
  drawTrail(strokeWidth, gfx) {
    const g = gfx || window;
    g.strokeWeight(strokeWidth * this.stepSize);

    g.push();
    g.stroke(0, 0, 5, agentAlpha);
    g.line(this.vectorOld.x, this.vectorOld.y, this.vector.x, this.vector.y);
    g.pop();

    // Store current position for the next segment.
    this.vectorOld = this.vector.copy();
  }

  /**
   * update1: continuous flow field (smooth)
   * Signature: (strokeWidth, noiseScale, noiseZVelocity)
   * Optional 4th arg `opts`:
   *  - flowK:     flow force strength
   *  - drag:      damping amount (0..1)
   *  - kick:      impulse added to velocity (short press)
   *  - disturb:   p5.Vector force (hold / external)
   */
  update1(strokeWidth, noiseScale, noiseZVelocity, opts = {}) {
    const flowK = opts.flowK ?? 0.35;
    const drag = opts.drag ?? 0.02;
    const kick = opts.kick ?? 0;
    const disturb = opts.disturb ?? null;

    // --- Flow Force (Perlin noise direction field) ---
    // noise in [0,1] -> angle in [0, TWO_PI]
    this.angle =
      noise(
        this.vector.x / (noiseScale * 2),
        this.vector.y / noiseScale,
        this.noiseZ
      ) * TWO_PI;

    const flow = p5.Vector.fromAngle(this.angle).mult(flowK);
    this.applyForce(flow);

    // --- Disturb Force (optional continuous force) ---
    this.applyForce(disturb);

    // --- Impulse (short press kick) ---
    if (kick > 0) {
      this.vel.add(p5.Vector.random2D().mult(kick));
    }

    // physics
    this.integrate(drag);
    this.wrap();

    // visuals
    this.drawTrail(strokeWidth, opts.gfx);

    // advance 3D noise time
    this.noiseZ += noiseZVelocity;
  }

  /**
   * update2: quantised / segmented flow (more unstable)
   * Signature kept: (strokeWidth, noiseScale, noiseStrength, noiseZVelocity)
   * Optional 5th arg `opts`:
   *  - segments:  number of direction segments
   *  - flowK:     flow force strength
   *  - drag:      damping amount
   *  - kick:      impulse
   *  - disturb:   continuous force
   */
  update2(strokeWidth, noiseScale, noiseStrength, noiseZVelocity, opts = {}) {
    const segments = opts.segments ?? 24;
    const flowK = opts.flowK ?? 0.55;
    const drag = opts.drag ?? 0.03;
    const kick = opts.kick ?? 0;
    const disturb = opts.disturb ?? null;

    // --- Flow Force (quantised) ---
    let a =
      noise(
        this.vector.x / (noiseScale * 0.5),
        this.vector.y / noiseScale,
        this.noiseZ
      ) * segments;

    // quantise: keep only fractional part, then scale
    a = (a - floor(a)) * noiseStrength;

    // map to a full circle for a stronger "field" feel
    this.angle = (a / max(noiseStrength, 0.0001)) * TWO_PI;

    const flow = p5.Vector.fromAngle(this.angle).mult(flowK);
    this.applyForce(flow);

    // Disturb / impulse
    this.applyForce(disturb);
    if (kick > 0) {
      this.vel.add(p5.Vector.random2D().mult(kick));
    }

    // physics
    this.integrate(drag);
    this.wrap();

    // visuals
    this.drawTrail(strokeWidth, opts.gfx);

    // advance 3D noise time
    this.noiseZ += noiseZVelocity;
  }
}
