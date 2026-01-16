// Simple FSR readout for quick wiring / sensor sanity check.
int fsrPin = A0;

void setup() {
  // Serial output for the Serial Monitor (or p5.js during testing).
  Serial.begin(9600);
}

void loop() {
  // Stream raw analog value so you can confirm pressure response.
  Serial.println(analogRead(fsrPin));
  delay(100);
}
