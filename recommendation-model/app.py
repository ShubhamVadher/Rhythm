from flask import Flask, request, jsonify
import pandas as pd
from flask_cors import CORS

# Import your Chef!
from src.recommendation_model import generate_recommendations

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}) 

@app.route('/api/recommend', methods=['POST'])
def recommend():
    try:
        data = request.get_json()
        
        raw_tracks = data.get('tracks', [])
        raw_artists = data.get('artists', [])
        raw_genres = data.get('genres', [])
        raw_albums = data.get('albums', [])
        
        if not raw_tracks:
            return jsonify({"error": "No tracks provided"}), 400
        
        top_user_tracks_df = pd.DataFrame(raw_tracks)
        
        top_artists_genres_df = pd.DataFrame({
            "favorite_artists": [", ".join(raw_artists)],
            "favorite_genres": [", ".join(raw_genres)],
            "favorite_albums": [", ".join(raw_albums)]
        })

        recommendations = generate_recommendations(top_user_tracks_df, top_artists_genres_df)
        
        return jsonify({
            "status": "success", 
            "recommendations": recommendations
        }), 200

    except Exception as e:
        print(f"Flask Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5001)