import re
import joblib
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.metrics.pairwise import cosine_similarity
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "processed"

def load_processed_data():
    songs = joblib.load(DATA_DIR / "songs.pkl")

    audio_matrix = np.load(DATA_DIR / "audio_matrix.npy")

    tfidf_matrix = sparse.load_npz(DATA_DIR / "tfidf_matrix.npz")

    vectorizer = joblib.load(DATA_DIR / "tfidf_vectorizer.pkl")

    scaler = joblib.load(DATA_DIR / "scaler.pkl")

    return songs, audio_matrix, tfidf_matrix, vectorizer, scaler

songs, audio_matrix, tfidf_matrix, vectorizer, scaler = load_processed_data()

def normalize(feature, prefix):
    if pd.isna(feature):
        return ""

    feature = feature.split(",")

    feature = [
        f"{prefix}_{f.strip().lower().replace(' ', '_')}"
        for f in feature
    ]

    return " ".join(feature)

def build_audio_profile(top_tracks_df):
    audio_cols = [
        'energy', 'danceability', 'valence', 'speechiness', 
        'liveness', 'acousticness', 'instrumentalness', 
        'tempo', 'loudness'
    ]

    features_df = top_tracks_df[audio_cols].dropna()

    if features_df.empty:
        return np.zeros((1, len(audio_cols)))
    
    user_audio_profile_mean = features_df.mean(axis=0)
    scaler_feature_names = [
        'Energy', 'Danceability', 'Positiveness', 'Speechiness', 'Liveness', 
        'Acousticness', 'Instrumentalness', 'Tempo', 'Loudness (db)'
    ]
    user_audio_profile = pd.DataFrame([user_audio_profile_mean.values], columns=scaler_feature_names)
    scaled_user_audio_profile = scaler.transform(user_audio_profile)
    return scaled_user_audio_profile

def build_text_profile(metadata_df):
    fav_artists = metadata_df['favorite_artists'].iloc[0]
    fav_genres = metadata_df['favorite_genres'].iloc[0]
    fav_albums = metadata_df['favorite_albums'].iloc[0]

    artist_query = normalize(fav_artists, "artist")
    genre_query = normalize(fav_genres, "genre")
    album_query = normalize(fav_albums, "album")

    combined_query = f"{artist_query} {genre_query} {album_query}".strip()

    user_text_vector = vectorizer.transform([combined_query])   

    return user_text_vector

def song_key(song, artist):
    # "Another Day In Paradise" / "Another Day in Paradise - 2016 Remaster" / "... (Live)" -> same key
    song, artist = str(song).lower(), str(artist).lower()
    version_suffix = r" - [^-]*\b(remaster(ed)?|live|version|edit|mix|mono|stereo|acoustic|demo|single|bonus|explicit)\b.*$"
    title = re.sub(r"[^\w]", "", re.sub(rf"\(.*?\)|\[.*?\]|{version_suffix}", "", song)) or song
    main_artist = re.sub(r"[^\w]", "", artist.split(",")[0])
    return title, main_artist

def diversify(df, indices, scores, max_cnt=3, n=50):
    recs = []
    artists = {}
    seen_songs = set()

    for idx in indices:
        row = df.iloc[idx]
        artist = row["Artist(s)"]

        # A missing title would serialize as NaN, which is invalid JSON for the Node server.
        if pd.isna(row["song"]) or artists.get(artist, 0) >= max_cnt:
            continue

        key = song_key(row["song"], artist)
        if key in seen_songs:
            continue
        seen_songs.add(key)

        artists[artist] = artists.get(artist, 0) + 1

        recs.append({
            "song":row["song"],
            "artist": artist,
            "genre": row.get("Genre", "Unknown"),
            "score": float(scores[idx])
        })

        if len(recs) == n:
            break

    return recs

def generate_recommendations(top_tracks_df, metadata_df, alpha=0.45, beta=0.3, gamma=0.25):
    user_audio_vector = build_audio_profile(top_tracks_df)
    user_text_vector = build_text_profile(metadata_df)

    audio_sim = cosine_similarity(user_audio_vector, audio_matrix).flatten()
    text_sim = cosine_similarity(user_text_vector, tfidf_matrix).flatten()

    if audio_sim.max() > audio_sim.min():
        audio_sim = (audio_sim - audio_sim.min()) / (audio_sim.max() - audio_sim.min())
        
    if text_sim.max() > text_sim.min():
        text_sim = (text_sim - text_sim.min()) / (text_sim.max() - text_sim.min())

    popularity_score = (songs["Popularity"].fillna(0) / 100.0).values

    final_scores = (alpha * audio_sim) + (beta * text_sim) + (gamma * popularity_score)

    user_track_names = top_tracks_df['track_name'].str.lower().tolist()
    known_indices = songs[songs['song'].str.lower().isin(user_track_names)].index
    final_scores[known_indices] = -1

    top_1000_indices = np.argsort(final_scores)[-1000:][::-1]
    final_recommendations = diversify(
        df=songs,
        indices=top_1000_indices,
        scores=final_scores,
        max_cnt=3,
        n=50
    )

    return final_recommendations


if __name__ == "__main__":
    print("Testing Recommendation Engine Locally...")
    
    dummy_tracks = pd.DataFrame([
        {
            "track_name": "Runaway",
            "danceability": 0.374, "energy": 0.568, "key": 1, 
            "loudness": -3.825, "mode": 0, "speechiness": 0.109, 
            "acousticness": 0.219, "instrumentalness": 0.00219, 
            "liveness": 0.513, "valence": 0.111, "tempo": 84.733
        },
        {
            "track_name": "Flashing Lights",
            "danceability": 0.439, "energy": 0.628, "key": 6, 
            "loudness": -4.457, "mode": 0, "speechiness": 0.0399, 
            "acousticness": 0.0381, "instrumentalness": 0.00000, 
            "liveness": 0.386, "valence": 0.432, "tempo": 90.04
        }
    ])

    dummy_metadata = pd.DataFrame([{
        "favorite_artists": "Kanye West, Travis Scott",
        "favorite_genres": "hip hop, rap",
        "favorite_albums": "My Beautiful Dark Twisted Fantasy, Astroworld"
    }])

    # 3. Run the engine
    print("Calculating scores...")
    results = generate_recommendations(dummy_tracks, dummy_metadata)
    
    # 4. Display results
    print(f"\nSuccessfully generated {len(results)} recommendations!")
    for i, rec in enumerate(results[:5]):  # Print top 5
        print(f"{i+1}. {rec['song']} by {rec['artist']} (Score: {rec['score']:.3f})")
