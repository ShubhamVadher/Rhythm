import React from 'react'
import { useAuth } from '../context/AuthContext'

export const Navbar = () => {
    const { user, logout } = useAuth()

    const handleLogin = () => {
        // Redirects via Vite proxy → server /auth/spotify → Spotify OAuth
        window.location.href = '/auth/spotify'
    }

    return (
        <header style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #ccc', marginBottom: '20px' }}>
            <div>
                <strong>Rhythm App</strong>
            </div>
            <nav>
                {user ? (
                    <div>
                        <span>Logged in as: <strong>{user.name}</strong> (ID: {user.account_id}) </span>
                        <button onClick={logout}>Logout</button>
                    </div>
                ) : (
                    <button onClick={handleLogin}>Connect Spotify</button>
                )}
            </nav>
        </header>
    )
}
