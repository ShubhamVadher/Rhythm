import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Navbar.css'

export const Navbar = () => {
    const { user, logout } = useAuth()
    const navigate = useNavigate()

    const handleLogin = () => {
        window.location.href = '/auth/spotify'
    }

    return (
        <header className="navbar-header">
            <div className="navbar-brand" onClick={() => navigate('/')}>
                <span className="navbar-logo-symbol">♪</span>
                <span className="navbar-logo-text">Rhythm</span>
            </div>
            <nav className="navbar-nav">
                {user ? (
                    <>
                        <button
                            id="get-recommendations-btn"
                            className="navbar-btn-recommend"
                            onClick={() => navigate('/recommendations')}
                        >
                            Get Recommendations
                        </button>
                        <span className="navbar-user-info">{user.name}</span>
                        <button
                            className="navbar-btn-logout"
                            onClick={logout}
                        >
                            Logout
                        </button>
                    </>
                ) : (
                    <button
                        className="navbar-btn-login"
                        onClick={handleLogin}
                    >
                        Connect Spotify
                    </button>
                )}
            </nav>
        </header>
    )
}
