#!/usr/bin/env node
// Generates one video script using Gemini 2.5 Flash (free tier).
// Usage: GEMINI_API_KEY=xxx node scripts/generate_script.mjs
//
// Reads/writes content/state.json to rotate through topic lanes.
// Writes the result to content/script-<index>.json in the exact shape Reel.tsx expects.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextTopicLane } from '../lib/topics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, '..', 'content');
const STATE_PATH = path.join(CONTENT_DIR, 'state.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You write short-form video scripts for "The Unspoken Mind," a YouTube Shorts channel.

VOICE: Confident, insider-knowledge, smart-edgy. You're revealing something the viewer didn't know about how minds work. NOT clinical/textbook. NOT gross or trashy manipulation-bait. Think: "insider explaining the hidden mechanics of human behavior."

FORMAT RULES:
- Hook: one punchy sentence, no more than 12 words, creates a curiosity gap. Must wrap 2-4 key words in curly braces like {this} to mark the single most important phrase for visual emphasis (e.g. "Someone is quietly {controlling your decisions} right now."). Optionally a short italic subhook (under 8 words).
- Exactly 3 points. Each point is ONE sentence, under 16 words, and must wrap exactly one key phrase in curly braces like {this} to mark it for highlight styling. Only one highlighted phrase per point, 1-3 words.
- CTA: always exactly "Follow — The Unspoken Mind"
- Total spoken/read length must fit 15-30 seconds out loud (roughly 45-70 words total across hook+points).
- No emojis. No hashtags. No exclamation-point spam.

Return ONLY valid JSON, no markdown fences, matching this shape:
{
  "hook": string,
  "subhook": string | null,
  "points": [ { "label": "01", "text": string, "highlight": string }, ... exactly 3 ],
  "cta": "Follow — The Unspoken Mind"
}`;

function loadState() {
	if (fs.existsSync(STATE_PATH)) {
		return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
	}
	return { lastLaneId: null, videoIndex: 0 };
}

function saveState(state) {
	fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function extractHighlightWord(pointText) {
	const match = pointText.match(/\{([^}]+)\}/);
	return match ? match[1] : '';
}

async function callGemini(lane) {
	const userPrompt = `Topic lane: ${lane.label}\nGuidance: ${lane.guidance}\n\nWrite one script now.`;

	const body = {
		contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
		systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
		generationConfig: {
			temperature: 0.9,
			responseMimeType: 'application/json',
		},
	};

	const res = await fetch(GEMINI_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Gemini API error ${res.status}: ${errText}`);
	}

	const data = await res.json();
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) throw new Error('No text returned from Gemini response: ' + JSON.stringify(data));

	return JSON.parse(text);
}

async function main() {
	if (!GEMINI_API_KEY) {
		console.error('Missing GEMINI_API_KEY environment variable.');
		process.exit(1);
	}

	const state = loadState();
	const lane = nextTopicLane(state.lastLaneId);

	console.log(`Generating script for topic lane: ${lane.label}`);

	const raw = await callGemini(lane);

	// Fill in highlight field defensively if the model omitted it
	const points = raw.points.map((p) => ({
		label: p.label,
		text: p.text,
		highlight: p.highlight || extractHighlightWord(p.text),
	}));

	const nextIndex = state.videoIndex + 1;
	const script = {
		id: `script-${String(nextIndex).padStart(3, '0')}`,
		topic_lane: lane.id,
		hook: raw.hook,
		subhook: raw.subhook || undefined,
		points,
		cta: raw.cta || 'Follow — The Unspoken Mind',
		target_seconds: 22,
	};

	const outPath = path.join(CONTENT_DIR, `${script.id}.json`);
	fs.writeFileSync(outPath, JSON.stringify(script, null, 2));

	saveState({ lastLaneId: lane.id, videoIndex: nextIndex });

	console.log(`Wrote ${outPath}`);
	console.log(JSON.stringify(script, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
