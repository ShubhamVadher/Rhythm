require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const createToken = require('./JWT/jwttoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const requireAuth = require('./Middleware/middleware');
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


app.get('/auth/me', requireAuth, async (req, res) => {
    try {
        const dbUser = await User.findOne({ account_id: req.jwtPayload.account_id });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        return res.json({
            user: {
                account_id: dbUser.account_id,
                name: dbUser.name,
                fav_artists: dbUser.fav_artists || [],
                fav_genres: dbUser.fav_genres || [],
            }
        });
    } catch (err) {
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/user/preferences', requireAuth, async (req, res) => {
    const { fav_artists, fav_genres } = req.body;

    if (!Array.isArray(fav_artists) || fav_artists.length < 3 || fav_artists.length > 10) {
        return res.status(400).json({ error: 'fav_artists must be an array of 3–10 items.' });
    }
    if (!Array.isArray(fav_genres) || fav_genres.length < 3 || fav_genres.length > 10) {
        return res.status(400).json({ error: 'fav_genres must be an array of 3–10 items.' });
    }

    try {
        const dbUser = await User.findOneAndUpdate(
            { account_id: req.jwtPayload.account_id },
            { fav_artists, fav_genres },
            { new: true }
        );
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        return res.json({
            success: true,
            user: {
                account_id: dbUser.account_id,
                name: dbUser.name,
                fav_artists: dbUser.fav_artists,
                fav_genres: dbUser.fav_genres,
            }
        });
    } catch (err) {
        console.error('Preferences update error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
});

async function getSpotifyAccessToken(accountId) {
    const user = await User.findOne({ account_id: accountId });
    if (!user || !user.refresh_token) return null;

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: user.refresh_token,
            client_id: process.env.SPOTIFY_CLIENT_ID,
        }),
    });

    const data = await response.json();
    if (data.error) return null;

    return data.access_token; // fresh, valid for 1 hour, used immediately and discarded
}

app.get('/me/top-tracks', requireAuth, async (req, res) => {
    const accessToken = await getSpotifyAccessToken(req.jwtPayload.account_id);
    if (!accessToken) return res.status(401).json({ error: 'Spotify reconnect needed' });

    const timeRange = req.query.time_range || 'long_term';
    const limit = req.query.limit || 50;
    const response = await fetch(
        `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await response.json();
    res.json(data);
});

app.get('/me/recently-played', requireAuth, async (req, res) => {
    const accessToken = await getSpotifyAccessToken(req.jwtPayload.account_id);
    if (!accessToken) return res.status(401).json({ error: 'Spotify reconnect needed' });

    const limit = req.query.limit || 50;
    const response = await fetch(
        `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await response.json();
    res.json(data);
});

app.post('/auth/logout', (req, res) => {
    res.clearCookie('rhythm_token', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
    });
    return res.json({ success: true, message: 'Logged out' });
});


async function safeFetch(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    try {
        return { status: response.status, data: JSON.parse(text) };
    } catch {
        return { status: response.status, data: { raw_error: text } };
    }
}

// GET /me/enriched-tracks

app.get('/me/enriched-tracks', requireAuth, async (req, res) => {
    try {

        const accessToken = await getSpotifyAccessToken(req.jwtPayload.account_id);
        if (!accessToken) {
            return res.status(401).json({ error: 'Spotify reconnect needed' });
        }


        const { data: recentData } = await safeFetch(
            'https://api.spotify.com/v1/me/player/recently-played?limit=50',
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!recentData.items || recentData.items.length === 0) {
            return res.json({ tracks: [] });
        }


        const seenIds = new Set();
        const uniqueTracks = recentData.items.filter(item => {
            if (seenIds.has(item.track.id)) return false;
            seenIds.add(item.track.id);
            return true;
        });


        const spotifyDataMap = {};
        const spotifyIds = [];

        for (const item of uniqueTracks) {
            const t = item.track;
            spotifyIds.push(t.id);
            spotifyDataMap[t.id] = {
                spotify_track_id: t.id,
                track_name: t.name,
                album_name: t.album.name,
                album_image: t.album.images?.[0]?.url || null,
                release_date: t.album.release_date,
                duration_ms: t.duration_ms,
                explicit: t.explicit,
                played_at: item.played_at,
                source_type: item.context?.type || 'unknown',
                artists: t.artists.map(a => ({
                    id: a.id,
                    name: a.name,
                })),
            };
        }


        const idsQuery = spotifyIds.map(id => `ids=${id}`).join('&');
        const { data: reccoTracksData } = await safeFetch(
            `https://api.reccobeats.com/v1/track?${idsQuery}`
        );


        const reccoIdMap = {};
        const reccoTracks = reccoTracksData?.content || reccoTracksData?.tracks || reccoTracksData || [];

        for (const track of reccoTracks) {

            const spotifyId = track.href?.split('/track/')?.[1];
            if (spotifyId) {
                reccoIdMap[spotifyId] = {
                    reccobeats_id: track.id,
                    popularity: track.popularity ?? null,
                };
            }
        }


        const audioFeaturesMap = {};

        await Promise.all(
            Object.entries(reccoIdMap).map(async ([spotifyId, { reccobeats_id }]) => {
                if (!reccobeats_id) return;

                const { data: features } = await safeFetch(
                    `https://api.reccobeats.com/v1/track/${reccobeats_id}/audio-features`
                );

                audioFeaturesMap[spotifyId] = {
                    danceability: features.danceability ?? null,
                    energy: features.energy ?? null,
                    key: features.key ?? null,
                    loudness: features.loudness ?? null,
                    mode: features.mode ?? null,
                    speechiness: features.speechiness ?? null,
                    acousticness: features.acousticness ?? null,
                    instrumentalness: features.instrumentalness ?? null,
                    liveness: features.liveness ?? null,
                    valence: features.valence ?? null,
                    tempo: features.tempo ?? null,
                };
            })
        );


        const enrichedTracks = spotifyIds.map(spotifyId => {
            const spotify = spotifyDataMap[spotifyId];
            const recco = reccoIdMap[spotifyId] || {};
            const features = audioFeaturesMap[spotifyId] || {};

            return {

                spotify_track_id: spotifyId,
                reccobeats_id: recco.reccobeats_id || null,


                track_name: spotify.track_name,
                album_name: spotify.album_name,
                album_image: spotify.album_image,
                release_date: spotify.release_date,
                artists: spotify.artists,
                duration_ms: spotify.duration_ms,
                explicit: spotify.explicit,
                played_at: spotify.played_at,
                source_type: spotify.source_type,


                popularity: recco.popularity || null,

                danceability: features.danceability ?? null,
                energy: features.energy ?? null,
                key: features.key ?? null,
                loudness: features.loudness ?? null,
                mode: features.mode ?? null,
                speechiness: features.speechiness ?? null,
                acousticness: features.acousticness ?? null,
                instrumentalness: features.instrumentalness ?? null,
                liveness: features.liveness ?? null,
                valence: features.valence ?? null,
                tempo: features.tempo ?? null,
            };
        });

        res.json({
            count: enrichedTracks.length,
            tracks: enrichedTracks,
        });

    } catch (err) {
        console.error('enriched-tracks error:', err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

app.get('/me/top-tracks-enriched', requireAuth, async (req, res) => {
    try {
        const { time_range = 'medium_term' } = req.query;


        const accessToken = await getSpotifyAccessToken(req.jwtPayload.account_id);
        if (!accessToken) {
            return res.status(401).json({ error: 'Spotify reconnect needed' });
        }


        const { data: topData } = await safeFetch(
            `https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${time_range}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!topData.items || topData.items.length === 0) {
            return res.json({ tracks: [] });
        }


        const seenIds = new Set();
        const uniqueTracks = topData.items.filter(item => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
        });


        const spotifyDataMap = {};
        const spotifyIds = [];

        for (const item of uniqueTracks) {
            spotifyIds.push(item.id);
            spotifyDataMap[item.id] = {
                spotify_track_id: item.id,
                track_name: item.name,
                album_name: item.album.name,
                album_image: item.album.images?.[0]?.url || null,
                release_date: item.album.release_date,
                duration_ms: item.duration_ms,
                explicit: item.explicit,
                popularity: item.popularity, // top tracks includes this directly
                source_type: 'top_tracks',
                artists: item.artists.map(a => ({
                    id: a.id,
                    name: a.name,
                })),
            };
        }


        const idsQuery = spotifyIds.map(id => `ids=${id}`).join('&');
        const { data: reccoTracksData } = await safeFetch(
            `https://api.reccobeats.com/v1/track?${idsQuery}`
        );

        const reccoIdMap = {};
        const reccoTracks = reccoTracksData?.content || reccoTracksData?.tracks || reccoTracksData || [];

        for (const track of reccoTracks) {
            const spotifyId = track.href?.split('/track/')?.[1];
            if (spotifyId) {
                reccoIdMap[spotifyId] = {
                    reccobeats_id: track.id,
                    popularity: track.popularity ?? null,
                };
            }
        }


        const audioFeaturesMap = {};

        await Promise.all(
            Object.entries(reccoIdMap).map(async ([spotifyId, { reccobeats_id }]) => {
                if (!reccobeats_id) return;

                const { data: features } = await safeFetch(
                    `https://api.reccobeats.com/v1/track/${reccobeats_id}/audio-features`
                );

                audioFeaturesMap[spotifyId] = {
                    danceability: features.danceability ?? null,
                    energy: features.energy ?? null,
                    key: features.key ?? null,
                    loudness: features.loudness ?? null,
                    mode: features.mode ?? null,
                    speechiness: features.speechiness ?? null,
                    acousticness: features.acousticness ?? null,
                    instrumentalness: features.instrumentalness ?? null,
                    liveness: features.liveness ?? null,
                    valence: features.valence ?? null,
                    tempo: features.tempo ?? null,
                };
            })
        );


        const enrichedTracks = spotifyIds.map(spotifyId => {
            const spotify = spotifyDataMap[spotifyId];
            const recco = reccoIdMap[spotifyId] || {};
            const features = audioFeaturesMap[spotifyId] || {};

            return {
                spotify_track_id: spotifyId,
                reccobeats_id: recco.reccobeats_id || null,
                track_name: spotify.track_name,
                album_name: spotify.album_name,
                album_image: spotify.album_image,
                release_date: spotify.release_date,
                artists: spotify.artists,
                duration_ms: spotify.duration_ms,
                explicit: spotify.explicit,
                popularity: spotify.popularity || recco.popularity || null,
                source_type: spotify.source_type,
                danceability: features.danceability ?? null,
                energy: features.energy ?? null,
                key: features.key ?? null,
                loudness: features.loudness ?? null,
                mode: features.mode ?? null,
                speechiness: features.speechiness ?? null,
                acousticness: features.acousticness ?? null,
                instrumentalness: features.instrumentalness ?? null,
                liveness: features.liveness ?? null,
                valence: features.valence ?? null,
                tempo: features.tempo ?? null,
            };
        });

        res.json({
            time_range,
            count: enrichedTracks.length,
            tracks: enrichedTracks,
        });

    } catch (err) {
        console.error('top-tracks-enriched error:', err);
        res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
});

app.get('/artist_genre',requireAuth,(req,res)=>{
    const user=req.user;

    res.status(200).json({
        genres:user.fav_genres,
        artists:user.fav_artists
    })
})

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});