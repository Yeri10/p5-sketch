const int fsr1Pin = A0;
const int fsr2Pin = A1;

// ---------- Tuning ----------
const int baud = 9600;

// Oversampling: average N reads to reduce noise
const uint8_t oversampleN = 8;

// EMA smoothing (0..1). Higher = more responsive, lower = smoother.
const float emaAlpha = 0.25f;

// Noise gate: values below this are treated as 0.
// (adjust after you see your resting baseline)
int gate = 20;

// Optional: clamp peaks to avoid weird spikes
const int maxClamp = 1023;

// Auto-baseline calibration time at start (ms)
const unsigned long calibrateMs = 1500;

// Send rate (ms). 10~30ms gives ~100Hz~33Hz.
const unsigned long sendIntervalMs = 20;

// ---------- State ----------
float fsr1Smooth = 0;
float fsr2Smooth = 0;

int baseline1 = 0;
int baseline2 = 0;

unsigned long lastSend = 0;

// Read averaged analog value
int readAvg(int pin, uint8_t n) {
  long sum = 0;
  for (uint8_t i = 0; i < n; i++) {
    sum += analogRead(pin);
    delayMicroseconds(600);
  }
  int v = (int)(sum / n);
  if (v < 0) v = 0;
  if (v > maxClamp) v = maxClamp;
  return v;
}

// Simple baseline calibration: average readings while user not pressing
void calibrateBaseline() {
  unsigned long start = millis();
  long sum1 = 0, sum2 = 0;
  int count = 0;

  while (millis() - start < calibrateMs) {
    int r1 = readAvg(fsr1Pin, oversampleN);
    int r2 = readAvg(fsr2Pin, oversampleN);

    sum1 += r1;
    sum2 += r2;
    count++;

    delay(10);
  }

  if (count > 0) {
    baseline1 = (int)(sum1 / count);
    baseline2 = (int)(sum2 / count);
  } else {
    baseline1 = baseline2 = 0;
  }

  // Set gate slightly above baseline to avoid “floating jitter”
  // You can tighten/loosen this later.
  int baseMax = (baseline1 > baseline2) ? baseline1 : baseline2;
  gate = baseMax + 15; // baseline + margin
}

void setup() {
  Serial.begin(baud);
  delay(300);

  // Warm up ADC slightly
  (void)analogRead(fsr1Pin);
  (void)analogRead(fsr2Pin);
  delay(50);

  calibrateBaseline();

  // Initialize EMA to baseline
  fsr1Smooth = baseline1;
  fsr2Smooth = baseline2;

  // IMPORTANT: Do NOT print any text labels.
  // p5.js expects only "v1,v2" lines.
}

void loop() {
  // Read raw values (averaged)
  int r1 = readAvg(fsr1Pin, oversampleN);
  int r2 = readAvg(fsr2Pin, oversampleN);

  // Baseline removal (optional): helps when resting value isn't near 0
  r1 = r1 - baseline1;
  r2 = r2 - baseline2;
  if (r1 < 0) r1 = 0;
  if (r2 < 0) r2 = 0;

  // EMA smoothing
  fsr1Smooth = (1.0f - emaAlpha) * fsr1Smooth + emaAlpha * r1;
  fsr2Smooth = (1.0f - emaAlpha) * fsr2Smooth + emaAlpha * r2;

  int v1 = (int)(fsr1Smooth + 0.5f);
  int v2 = (int)(fsr2Smooth + 0.5f);

  // Noise gate
  if (v1 < gate) v1 = 0;
  if (v2 < gate) v2 = 0;

  // Send at fixed interval
  unsigned long now = millis();
  if (now - lastSend >= sendIntervalMs) {
    lastSend = now;

    // Output MUST be: number,number\n
    Serial.print(v1);
    Serial.print(",");
    Serial.println(v2);
  }
}
