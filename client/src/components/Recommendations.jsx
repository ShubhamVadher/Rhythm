import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Navbar } from './Navbar.jsx'
import './Recommendations.css'

const Recommendations = () => {
  const [recommendations, setRecommendations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const fetchStarted = useRef(false)

  useEffect(() => {
    // Each run is a full ML pass; don't let StrictMode trigger it twice.
    if (fetchStarted.current) return
    fetchStarted.current = true

    const fetchRecommendations = async () => {
      try {
        setLoading(true)
        const res = await axios.get('/api/generate-playlist')
        setRecommendations(res.data.recommendations || [])
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to fetch recommendations')
      } finally {
        setLoading(false)
      }
    }
    fetchRecommendations()
  }, [])

  const openOnSpotify = (spotifyTrackId) => {
    if (spotifyTrackId) {
      window.open(`https://open.spotify.com/track/${spotifyTrackId}`, '_blank')
    }
  }

  if (loading) {
    return (
      <div className="rec-page">
        <Navbar />
        <div className="rec-loading-container">
          <div className="rec-spinner-wrap">
            <div className="rec-spinner" />
            <div className="rec-spinner-ring" />
          </div>
          <h2 className="rec-loading-title">Analyzing your taste...</h2>
          <p className="rec-loading-sub">Our ML engine is crafting your perfect playlist</p>
          <div className="rec-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rec-page">
        <Navbar />
        <div className="rec-error-container">
          <div className="rec-error-icon">⚠</div>
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button className="rec-back-btn" onClick={() => navigate('/')}>← Go Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rec-page">
      <Navbar />
      <div className="rec-container">
        <div className="rec-hero">
          <div className="rec-hero-glow" />
          <h1 className="rec-title">Your Recommendations</h1>
          <p className="rec-subtitle">AI-curated tracks based on your listening history</p>
          <div className="rec-pill">{recommendations.length} tracks found</div>
        </div>

        <div className="rec-grid">
          {recommendations.map((rec, index) => (
            <div className="rec-card" key={index}>
              <div
                className="rec-cover"
                onClick={() => openOnSpotify(rec.spotify_track_id)}
                title={rec.spotify_track_id ? 'Open on Spotify' : 'Track not found on Spotify'}
                style={{ cursor: rec.spotify_track_id ? 'pointer' : 'default' }}
              >
                {rec.album_image ? (
                  <img src={rec.album_image} alt={rec.song} className="rec-cover-img" />
                ) : (
                  <div className="rec-cover-placeholder">♪</div>
                )}
                {rec.spotify_track_id && (
                  <div className="rec-overlay">
                    <svg className="rec-spotify-icon" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    <span>Play on Spotify</span>
                  </div>
                )}
                <div className="rec-rank-badge">#{index + 1}</div>
              </div>

              <div className="rec-info">
                <h3 className="rec-song-name" title={rec.song}>{rec.song}</h3>
                <p className="rec-artist-name">{rec.artist}</p>
                {rec.genre && (
                  <span className="rec-genre-tag">{rec.genre}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Recommendations
