#!/usr/bin/env node
// Picks the next music track from your Google Drive folder, round-robin,
// and downloads it into public/audio/ for the render step to use.
//
// Auth: a Google Service Account (a "robot" credential, not your personal login).
// Setup (one-time):
//   1. Google Cloud Console -> create a project (or reuse one) -> enable the
//      "Google Drive API".
//   2. IAM & Admin -> Service Accounts -> Create Service Account -> create a
//      JSON key for it. This JSON file is what goes in the GitHub secret below.
//   3. Open your Drive music folder -> Share -> paste the service account's
//      email (looks like xxx@xxx.iam.gserviceaccount.com, found in the JSON
//      key as "client_email") -> give it Viewer access.
//   4. In your GitHub repo: Settings -> Secrets -> Actions -> add
//      GOOGLE_SERVICE_ACCOUNT_KEY = the *entire contents* of the JSON key file.
//   5. Set MUSIC_FOLDER_ID below to your folder's ID (the string after
//      /folders/ in the Drive URL, or the parentId shown by Drive search).
//
// Usage: GOOGLE_SERVICE_ACCOUNT_KEY='{...json...}' node scripts/fetch_music_drive.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');
const CONTENT_DIR = path.join(__dirname, '..', 'content');
const STATE_PATH = path.join(CONTENT_DIR, 'music_state.json');

// Folder ID for the Mixkit rotation folder in Drive. Override via env if it moves.
const MUSIC_FOLDER_ID = process.env.MUSIC_FOLDER_ID || '1GDfukm9HFM6Hrmdy_N7snsiSqQ8Sxk_3';

// Tracks that don't fit the locked cinematic/moody tone — skipped without touching
// the actual files in Drive. Remove a name here once you've swapped/replaced it,
// or delete this list entirely once the folder only has tone-appropriate tracks.
const EXCLUDED_TRACKS = ['mixkit-acid-party-420.mp3', 'mixkit-sad-jazz-649.mp3'];

function loadState() {
	if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
	return { lastIndex: -1 };
}

function saveState(state) {
	fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
	const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
	if (!keyJson) {
		console.error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable.');
		console.error('See the setup steps in this file\'s header comment.');
		process.exit(1);
	}

	const credentials = JSON.parse(keyJson);
	const auth = new google.auth.GoogleAuth({
		credentials,
		scopes: ['https://www.googleapis.com/auth/drive.readonly'],
	});
	const drive = google.drive({ version: 'v3', auth });

	// List audio files in the folder, sorted by name for a stable, predictable
	// round-robin order (adding new tracks just extends the rotation).
	const res = await drive.files.list({
		q: `'${MUSIC_FOLDER_ID}' in parents and mimeType contains 'audio/' and trashed = false`,
		fields: 'files(id, name)',
		orderBy: 'name',
		pageSize: 100,
	});

	const files = (res.data.files || []).filter((f) => !EXCLUDED_TRACKS.includes(f.name));
	if (files.length === 0) {
		throw new Error(`No usable audio files found in Drive folder ${MUSIC_FOLDER_ID} (after exclusions)`);
	}

	const state = loadState();
	const nextIndex = (state.lastIndex + 1) % files.length;
	const chosen = files[nextIndex];

	fs.mkdirSync(AUDIO_DIR, { recursive: true });
	const destPath = path.join(AUDIO_DIR, chosen.name);

	const fileRes = await drive.files.get(
		{ fileId: chosen.id, alt: 'media' },
		{ responseType: 'arraybuffer' }
	);
	fs.writeFileSync(destPath, Buffer.from(fileRes.data));

	saveState({ lastIndex: nextIndex });

	console.log(`Picked track ${nextIndex + 1}/${files.length}: ${chosen.name}`);
	console.log(`AUDIO_FILE=${chosen.name}`); // consumed by the orchestrator
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
