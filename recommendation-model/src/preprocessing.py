from pathlib import Path
import joblib
import pandas as pd
import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler


BASE_DIR = Path(__file__).resolve().parent.parent
DATASET_PATH = BASE_DIR / "data" / "raw" / "spotify_dataset.csv"
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


AUDIO_FEATURES = [
    "Energy",
    "Danceability",
    "Positiveness",
    "Speechiness",
    "Liveness",
    "Acousticness",
    "Instrumentalness",
    "Tempo",
    "Loudness (db)"
]


COLUMNS = [
    "song",
    "Artist(s)",
    "Genre",
    "Album",
    "Popularity",
    "Energy",
    "Danceability",
    "Positiveness",
    "Speechiness",
    "Liveness",
    "Acousticness",
    "Instrumentalness",
    "Tempo",
    "Loudness (db)"
]


def load_dataset(path: str) -> pd.DataFrame:
    return pd.read_csv(path)


def remove_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.drop_duplicates(ignore_index=True)
    return df


def select_columns(df: pd.DataFrame) -> pd.DataFrame:
    return df[COLUMNS].copy()


def process_loudness(df: pd.DataFrame) -> pd.DataFrame:
    df["Loudness (db)"] = df["Loudness (db)"].astype(str).str.replace("db", "",regex = False)
    df["Loudness (db)"] = pd.to_numeric(df["Loudness (db)"], errors="coerce")
    return df
    

def scale_audio_features(df: pd.DataFrame):

    scaler = StandardScaler()
    audio_df = df[AUDIO_FEATURES].copy()
    
    percentage_features = [
        "Energy",
        "Danceability",
        "Positiveness",
        "Speechiness",
        "Liveness",
        "Acousticness",
        "Instrumentalness"
    ]
    audio_df[percentage_features] = audio_df[percentage_features] / 100
    audio_matrix = scaler.fit_transform(audio_df)
    return scaler, audio_matrix


def build_metadata(df: pd.DataFrame):

    metadata = (
        df["Artist(s)"].fillna("") + " " +
        df["Genre"].fillna("")
    )
    return metadata


def build_tfidf(metadata):

    vectorizer = TfidfVectorizer(stop_words = "english" , min_df = 2)
    tfidf_matrix = vectorizer.fit_transform(metadata)
    return vectorizer, tfidf_matrix


def save_artifacts(df,scaler,vectorizer,audio_matrix,tfidf_matrix):

    df.to_csv(OUTPUT_DIR / "processed_songs.csv", index=False)
    joblib.dump(df,OUTPUT_DIR / "songs.pkl")
    joblib.dump(scaler,OUTPUT_DIR / "scaler.pkl")
    joblib.dump(vectorizer,OUTPUT_DIR / "tfidf_vectorizer.pkl")
    sparse.save_npz(OUTPUT_DIR / "tfidf_matrix.npz",tfidf_matrix)
    np.save(OUTPUT_DIR / "audio_matrix.npy",audio_matrix)


def main():

    df = load_dataset(DATASET_PATH)
    df = remove_duplicates(df)
    df = select_columns(df)
    df = process_loudness(df)
    scaler, audio_matrix = scale_audio_features(df)
    df["metadata"] = build_metadata(df)
    vectorizer, tfidf_matrix = build_tfidf(df["metadata"])

    save_artifacts(df,scaler,vectorizer,audio_matrix,tfidf_matrix)


if __name__ == "__main__":
    main()