#!/usr/bin/env node
// ONE-TIME, LOCAL-ONLY helper to generate a YouTube OAuth refresh token.
//
// This script is NOT part of the automated pipeline and never runs in
// GitHub Actions. Run it once, by hand, on your own machine, to produce the
// YOUTUBE_REFRESH_TOKEN value — then that token (not this script, not your
// client secret) is what goes into GitHub Secrets.
//
// WHAT IT DOES
//   1. Starts a tiny local web server on http://localhost:8991
//   2. Opens your browser to Google's consent screen, requesting:
//        - offline access (access_type: 'offline') so Google issues a
//          refresh token, not just a short-lived access token
//        - the exact scope YouTube uploads need:
//          https://www.googleapis.com/auth/youtube.upload
//        - prompt: 'consent' so Google reliably re-issues a refresh token
//          even if you've authorized this app before
//   3. You sign in as the Google account that owns "The Unspoken Mind" and
//      approve access.
//   4. Google redirects back to the local server with an auth code; the
//      script exchanges it for tokens and prints ONLY the refresh token to
//      your terminal.
//
// USAGE
//   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/get_youtube_refresh_token.mjs
//
// Do NOT put real credentials in this file or in any file you commit.
// Pass them as environment variables on the command line as shown above —
// they exist only in your shell for this one run.

import http from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';
import open from 'open';

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const PORT = 8991;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
	console.error('Missing YOUTUBE_CLIENT_ID and/or YOUTUBE_CLIENT_SECRET.');
	console.error('Run it like:');
	console.error('  YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/get_youtube_refresh_token.mjs');
	process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
	access_type: 'offline', // required — without this, Google does NOT return a refresh token
	prompt: 'consent', // forces the consent screen even on repeat authorizations, ensuring a refresh token is issued
	scope: ['https://www.googleapis.com/auth/youtube.upload'], // exact scope needed to upload videos
});

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://localhost:${PORT}`);
		if (url.pathname !== '/oauth2callback') {
			res.writeHead(404);
			res.end();
			return;
		}

		const code = url.searchParams.get('code');
		if (!code) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('No authorization code received. Check your terminal and try again.');
			server.close();
			return;
		}

		const { tokens } = await oauth2Client.getToken(code);

		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('Authorization complete — you can close this tab and return to your terminal.');
		server.close();

		if (!tokens.refresh_token) {
			console.error('\nNo refresh_token was returned.');
			console.error('This usually means the account already authorized this app before without');
			console.error('prompt=consent forcing a fresh grant. Go to https://myaccount.google.com/permissions,');
			console.error('remove access for this app, then re-run this script.');
			process.exit(1);
		}

		console.log('\n=== YOUTUBE_REFRESH_TOKEN ===');
		console.log(tokens.refresh_token);
		console.log('=== copy the line above into GitHub Secrets as YOUTUBE_REFRESH_TOKEN ===\n');
		process.exit(0);
	} catch (err) {
		console.error('Error exchanging code for tokens:', err.message);
		res.writeHead(500, { 'Content-Type': 'text/plain' });
		res.end('Something went wrong — check your terminal.');
		server.close();
		process.exit(1);
	}
});

server.listen(PORT, () => {
	console.log(`Local OAuth helper listening on ${REDIRECT_URI}`);
	console.log('Opening your browser to Google\'s consent screen...');
	console.log('IMPORTANT: sign in as the Google account that owns "The Unspoken Mind" channel.\n');
	open(authUrl);
});
