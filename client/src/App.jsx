import React, { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { Navbar } from './components/Navbar.jsx'
import Onboarding from './components/Onboarding.jsx'
import Recommendations from './components/Recommendations.jsx'
import { useAuth } from './context/AuthContext'
import './App.css'
import './Home.css'

const Home = () => {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  const handleLogin = () => {
    window.location.href = '/auth/spotify'
  }

  if (loading) {
    return (
      <div className="home-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="rec-spinner" />
      </div>
    )
  }

  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <Navbar />
      <main className="home-container">
        <div className="home-glow-1" />
        <div className="home-glow-2" />

        {!user ? (
          <div className="landing-hero">
            <span className="landing-tagline">Welcome to Rhythm</span>
            <h1 className="landing-title">
              Music Recommendations Powered by <span>AI</span>
            </h1>
            <p className="landing-desc">
              Connect your Spotify account and let our machine learning engine analyze your taste 
              to craft recommendations tailored uniquely to you.
            </p>
            <button className="landing-btn-login" onClick={handleLogin}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.564.387-.86.207-2.377-1.454-5.37-1.783-8.893-.982-.336.076-.67-.137-.747-.473-.077-.337.137-.67.473-.748 3.856-.88 7.15-.506 9.822 1.13.296.18.388.563.208.86zm1.224-2.722c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.078-1.182-.413.125-.848-.107-.973-.52-.125-.413.107-.847.52-.972 3.676-1.116 8.244-.575 11.345 1.334.367.226.487.707.26 1.074zm.102-2.883C14.512 8.79 9.066 8.61 5.922 9.564c-.476.144-.977-.123-1.121-.6-.145-.477.123-.978.6-.122 3.626-1.1 9.626-.902 13.593 1.453.429.255.57.81.315 1.24-.255.43-.81.571-1.24.316z"/>
              </svg>
              Login with Spotify
            </button>

            <div className="landing-features" style={{ marginTop: '80px' }}>
              <div className="feature-card">
                <span className="feature-icon">🧠</span>
                <h3>Hybrid ML Engine</h3>
                <p>Combines audio characteristics with metadata similarity models to surface songs you'll love.</p>
              </div>
              <div className="feature-card">
                <span className="feature-icon">⚡</span>
                <h3>Realtime Spotify Sync</h3>
                <p>Enrich your top tracks with detailed acoustic properties and play them directly inside your app.</p>
              </div>
              <div className="feature-card">
                <span className="feature-icon">🎨</span>
                <h3>Premium Audio Profile</h3>
                <p>Visualize and explore your acoustic taste with personalized genre tagging and custom layout views.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard-wrap">
            <div className="dashboard-header">
              <h1 className="dashboard-welcome">
                Welcome back, <span>{user.name}</span>
              </h1>
              <p className="dashboard-subtitle">Your personalized dashboard and settings</p>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-card">
                <h3 className="dashboard-card-title">Integration Details</h3>
                <div className="profile-info-row">
                  <span className="profile-info-label">Account ID</span>
                  <span className="profile-info-value">{user.account_id}</span>
                </div>
                <div className="profile-info-row">
                  <span className="profile-info-label">Spotify Sync</span>
                  <span className="profile-status-badge">Active</span>
                </div>
                <div className="profile-info-row" style={{ marginBottom: 0 }}>
                  <span className="profile-info-label">Database Status</span>
                  <span className="profile-status-badge">Connected</span>
                </div>
              </div>

              <div className="dashboard-card action-card">
                <h3 className="dashboard-card-title">Generate Playlist</h3>
                <p className="dashboard-action-desc">
                  Ready to listen to something new? Generate AI-curated recommendations based on your listening history and preferences.
                </p>
                <button className="dashboard-btn-recommend" onClick={() => navigate('/recommendations')}>
                  Get Recommendations →
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

const Callback = () => {
  const [searchParams] = useSearchParams()
  const { checkAuth } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const code = searchParams.get('code')

  useEffect(() => {
    const exchangeCode = async () => {
      if (!code) {
        setError('No auth code received from Spotify.')
        return
      }

      try {
        const response = await axios.post('/auth/spotify/callback', { code })

        if (response.data && response.data.success) {
          await checkAuth()
          // Check if onboarding is needed
          const meRes = await axios.get('/auth/me')
          const u = meRes.data?.user
          const needsOnboarding =
            !u ||
            !u.fav_artists ||
            u.fav_artists.length === 0 ||
            !u.fav_genres ||
            u.fav_genres.length === 0
          navigate(needsOnboarding ? '/onboarding' : '/')
        } else {
          setError('Authentication failed.')
        }
      } catch (err) {
        console.error(err)
        setError(err.response?.data?.error || err.message || 'Error logging in.')
      }
    }

    exchangeCode()
  }, [code, checkAuth, navigate])

  return (
    <div>
      {!error ? (
        <div>
          <h2>Logging in...</h2>
          <p>Exchanging Spotify credentials and persisting session.</p>
        </div>
      ) : (
        <div>
          <h2>Login Error</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/')}>Go Home</button>
        </div>
      )}
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/recommendations" element={<Recommendations />} />
    </Routes>
  )
}

export default App

