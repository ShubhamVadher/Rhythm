require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));

// ─── PKCE helpers ───────────────────────────────────────────
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

// ─── Safe fetch helper (won't crash on non-JSON responses) ──
async function spotifyFetch(url, token) {
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: { raw_error: text } };
    }
}

// ─── STEP 1: Hit this in browser to start the OAuth flow ────
app.get('/auth/spotify', (req, res) => {
    const { verifier, challenge } = generatePKCE();
    req.session.codeVerifier = verifier;

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        scope: [
            'user-top-read',
            'user-read-recently-played',
            'user-library-read',
            'user-read-private',
        ].join(' '),
        redirect_uri: process.env.REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state: crypto.randomBytes(8).toString('hex'),
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// ─── STEP 2: Spotify redirects here after you approve ───────
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    const verifier = req.session.codeVerifier;

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.REDIRECT_URI,
            client_id: process.env.SPOTIFY_CLIENT_ID,
            code_verifier: verifier,
        }),
    });

    const data = await response.json();

    if (data.error) {
        return res.json({ error: data });
    }

    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token;
    req.session.expiresAt = Date.now() + data.expires_in * 1000;

    res.json({
        message: 'Auth successful! Copy the access_token and use it in Postman as Bearer Token.',
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
    });
});


async function getValidToken(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }

    if (req.session.accessToken && Date.now() < req.session.expiresAt - 60000) {
        return req.session.accessToken;
    }

    return null;
}

// ─── DATA ROUTES ─────────────────────────────────────────────

// Your profile
app.get('/me', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.status(401).json({ error: 'No token. Visit /auth/spotify in your browser first.' });

    const { status, data } = await spotifyFetch('https://api.spotify.com/v1/me', token);
    res.status(status).json(data);
});

// Top tracks — ?time_range=short_term | medium_term | long_term  &limit=20
app.get('/me/top-tracks', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.status(401).json({ error: 'No token. Visit /auth/spotify in your browser first.' });

    const { time_range = 'medium_term', limit = 20 } = req.query;
    const { status, data } = await spotifyFetch(
        `https://api.spotify.com/v1/me/top/tracks?time_range=${time_range}&limit=${limit}`,
        token
    );
    res.status(status).json(data);
});

// Top artists — same query params as top-tracks
app.get('/me/top-artists', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.status(401).json({ error: 'No token. Visit /auth/spotify in your browser first.' });

    const { time_range = 'medium_term', limit = 20 } = req.query;
    const { status, data } = await spotifyFetch(
        `https://api.spotify.com/v1/me/top/artists?time_range=${time_range}&limit=${limit}`,
        token
    );
    res.status(status).json(data);
});

app.get('/debug', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.json({ error: 'No token found' });

    // Show what token is actually being used
    res.json({
        token_preview: token.substring(0, 20) + '...',
        token_length: token.length,
        source: req.headers['authorization'] ? 'Bearer header (Postman)' : 'Session (browser)'
    });
});

// Recently played (listening history)
app.get('/me/recently-played', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.status(401).json({ error: 'No token. Visit /auth/spotify in your browser first.' });

    const { limit = 50 } = req.query;
    const { status, data } = await spotifyFetch(
        `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
        token
    );
    res.status(status).json(data);
});

// Saved library tracks
app.get('/me/library', async (req, res) => {
    const token = await getValidToken(req);
    if (!token) return res.status(401).json({ error: 'No token. Visit /auth/spotify in your browser first.' });

    const { limit = 50 } = req.query;
    const { status, data } = await spotifyFetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}`,
        token
    );
    res.status(status).json(data);
});

app.get('/refresh', async (req, res) => {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: process.env.MY_REFRESH_TOKEN,
            client_id: process.env.SPOTIFY_CLIENT_ID,
        }),
    });

    const data = await response.json();
    res.json({ access_token: data.access_token });
});

// ─── Start server ─────────────────────────────────────────────
app.listen(process.env.PORT, () => {
    console.log(`Server running on http://127.0.0.1:${process.env.PORT}`);
    console.log(`Start here: http://127.0.0.1:${process.env.PORT}/auth/spotify`);
});