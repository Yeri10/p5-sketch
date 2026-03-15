# Project Title
Wuwei Engine

# Author
Yerie Ye

# Date
Saturday, 10 January 2026


# Description
Wu-Wei Engine is an interactive generative system built with p5.js, inspired by the Daoist concept of Wu Wei (non-action).
The project explores how human interaction can influence a system indirectly—by setting conditions rather than directly controlling visual outcomes.

Particle agents move through a Perlin-noise-based flow field.
User input introduces different levels of disturbance, allowing the system to shift between calm and chaotic states over time.


# How to Run
	1.	Open index.html in Google Chrome or Microsoft Edge
(Web Serial API is only supported in Chromium-based browsers).
	2.	The sketch will automatically fit the browser window.


# Interaction Instructions
Keyboard Controls (always available)
Key 1 — Hold / Calm mode
Simulates sustained pressure (Update 1)
Key 2 — Tap / Chaos mode
Simulates repeated tapping (Update 2)
Key F — Toggle fullscreen
Key S — Save a frame as PNG
Key C — Connect to Arduino via Web Serial

Keyboard input is retained as a fallback to ensure the system works even without hardware connected.


# Files Overview
•	index.html — Main HTML file
•	sketch.js — Core p5.js logic and interaction handling
•	Agent.js — Agent class (particle behaviour, forces, movement)
•	verses.json — Text content used in the interface
•	README.md — Project instructions (this file)


# Notes
•	The system is designed as a time-based process, not an outcome-driven visual.
•	Interaction influences system states gradually rather than triggering fixed results.

No other JavaScript libraries or shaders are used.


# Video Link
https://vimeo.com/1153428441?share=copy&fl=sv&fe=ci


# Acknowledgements
This project uses the following tools and resources:
•	p5.js
•	p5.sound
•	Arduino with the Web Serial API
•	ChatGPT for coding assistance
