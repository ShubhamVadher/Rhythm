import React, { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { Navbar } from './components/Navbar.jsx'
import { useAuth } from './context/AuthContext'
import './App.css'

const Home = () => {
  const { user, loading } = useAuth()

  const handleLogin = () => {
    // Redirect using relative path so Vite dev proxy handles it
    window.location.href = '/auth/spotify'
  }

  if (loading) {
    return <div>Loading authentication session...</div>
  }

  return (
    <div>
      <Navbar />
      <main>
        {!user ? (
          <div>
            <h1>Rhythm Spotify Login</h1>
            <p>Connect your Spotify account to log in.</p>
            <button onClick={handleLogin}>Login with Spotify</button>
          </div>
        ) : (
          <div>
            <h1>Dashboard</h1>
            <h2>Welcome, {user.name}!</h2>
            <p>Spotify Account ID: {user.account_id}</p>
            <p>Status: Logged In and Synchronized with DB</p>
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
        // Exchange code using relative path to trigger Vite proxy
        const response = await axios.post('/auth/spotify/callback', { code })

        if (response.data && response.data.success) {
          await checkAuth()
          navigate('/')
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
    </Routes>
  )
}

export default App
