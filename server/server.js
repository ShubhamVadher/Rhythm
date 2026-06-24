require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const createToken = require('./JWT/jwttoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const requireAuth=require('./Middleware/middleware');
const db = require('./config/connection');
const User = require('./Models/user');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
    origin: ['http://localhost:8888', 'http://127.0.0.1:8888'],
    credentials: true,          // needed so the browser sends cookies cross-origin
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const pkceStore = new Map();   




app.get('/auth/spotify', (req, res) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(8).toString('hex');

    // Store verifier keyed by state so we can look it up in the callback
    pkceStore.set(state, { verifier, createdAt: Date.now() });

    // Clean up stale entries (>10 min old) to avoid memory growth
    for (const [k, v] of pkceStore) {
        if (Date.now() - v.createdAt > 10 * 60 * 1000) pkceStore.delete(k);
    }

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
        state,
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});


app.post('/auth/spotify/callback', async (req, res) => {
    const { code, state } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Missing auth code' });
    }

    let verifier;
    if (state && pkceStore.has(state)) {
        verifier = pkceStore.get(state).verifier;
        pkceStore.delete(state);
    } else {
      
        const entries = [...pkceStore.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
        if (entries.length === 0) {
            return res.status(400).json({ error: 'PKCE verifier not found. Please restart the login flow.' });
        }
        verifier = entries[0][1].verifier;
        pkceStore.delete(entries[0][0]);
    }


    let tokenData;
    try {
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
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
        tokenData = await tokenRes.json();
    } catch (err) {
        console.error('Token exchange failed:', err);
        return res.status(500).json({ error: 'Token exchange failed' });
    }

    if (tokenData.error) {
        return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }

    const { access_token, refresh_token } = tokenData;

 
    let profile;
    try {
        const profileRes = await fetch('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        profile = await profileRes.json();
    } catch (err) {
        console.error('Profile fetch failed:', err);
        return res.status(500).json({ error: 'Could not fetch Spotify profile' });
    }

    if (!profile.id) {
        return res.status(400).json({ error: 'Spotify profile missing id', detail: profile });
    }

    let dbUser;
    try {
        dbUser = await User.findOneAndUpdate(
            { account_id: profile.id },
            {
                name: profile.display_name || profile.id,
                account_id: profile.id,
                refresh_token,
            },
            { upsert: true, new: true }
        );
    } catch (err) {
        console.error('DB upsert failed:', err);
        return res.status(500).json({ error: 'Database error' });
    }

    const jwtToken = createToken(dbUser);

    res.cookie('rhythm_token', jwtToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
        success: true,
        user: { account_id: dbUser.account_id, name: dbUser.name },
    });
});


app.get('/auth/me', requireAuth, (req, res) => {
    return res.json({ user: req.jwtPayload });
});


app.post('/auth/logout', (req, res) => {
    res.clearCookie('rhythm_token', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
    });
    return res.json({ success: true, message: 'Logged out' });
});


app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});