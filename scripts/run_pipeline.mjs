#!/usr/bin/env node
// Runs the full "Unspoken Psychology" pipeline end to end:
//   1. Generate script (Gemini)
//   2. Fetch music (Pixabay)
//   3. Render video (Remotion)
//   4. [Not yet wired] Upload to YouTube
//
// This is what the GitHub Actions workflow calls on the every-other-day schedule.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');

function run(cmd, opts = {}) {
	console.log(`\n$ ${cmd}`);
	return execSync(cmd, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf-8', ...opts });
}

async function main() {
	console.log('=== Step 1: Generate script ===');
	run('node scripts/generate_script.mjs', { cwd: ROOT });

	const state = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'state.json'), 'utf-8'));
	const scriptId = `script-${String(state.videoIndex).padStart(3, '0')}`;
	const scriptPath = path.join(CONTENT_DIR, `${scriptId}.json`);
	const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));

	console.log('\n=== Step 2: Pick music (Drive rotation) ===');
	const musicOutput = run('node scripts/fetch_music_drive.mjs', { cwd: ROOT });
	const audioMatch = musicOutput.match(/AUDIO_FILE=(.+)/);
	if (audioMatch) {
		script.audioFile = audioMatch[1].trim();
		fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
	}

	console.log('\n=== Step 3: Render video ===');
	const outFile = path.join(ROOT, 'out', `${scriptId}.mp4`);
	run(
		`npx remotion render src/index.ts Reel "${outFile}" --props="${scriptPath}" --codec=h264`,
		{ cwd: ROOT }
	);

	console.log(`\nDone. Rendered: ${outFile}`);
	console.log('\n=== Step 4: Upload to YouTube ===');
	console.log('Not yet wired up — waiting on YouTube API credentials.');
	console.log(`When ready: node scripts/upload_youtube.mjs "${outFile}" "${scriptPath}"`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
