import React, { useState, useEffect, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import artistsCsv from '../assets/artists.csv?url';
import genresCsv from '../assets/genres.csv?url';
import './Onboarding.css';

const MIN = 3;
const MAX = 10;

const cache = {};
function loadCsv(url, field) {
  if (cache[url]) return Promise.resolve(cache[url]);
  return new Promise((resolve) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const list = results.data.map((r) => r[field]?.trim()).filter(Boolean);
        cache[url] = list;
        resolve(list);
      },
    });
  });
}

function SearchBox({ placeholder, allItems, selected, onAdd, onRemove, step }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const atMax = selected.length >= MAX;

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allItems
      .filter((item) => item.toLowerCase().includes(q) && !selected.includes(item))
      .slice(0, 8);
  }, [query, allItems, selected]);

  useEffect(() => {
    setSuggestions(filtered);
  }, [filtered]);

  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        inputRef.current &&
        !inputRef.current.contains(e.target)
      ) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (item) => {
    if (atMax) return;
    onAdd(item);
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && suggestions.length > 0) {
      handleSelect(suggestions[0]);
    }
    if (e.key === 'Escape') {
      setFocused(false);
      setQuery('');
    }
  };

  return (
    <div className="ob-search-wrapper">
      <div className="ob-pills">
        {selected.map((item) => (
          <span className="ob-pill" key={item}>
            {item}
            <button className="ob-pill-remove" onClick={() => onRemove(item)} aria-label={`Remove ${item}`}>
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="ob-count-row">
        <span className={`ob-count ${selected.length < MIN ? 'warn' : 'ok'}`}>
          {selected.length} / {MAX} selected
        </span>
        {selected.length < MIN && (
          <span className="ob-count-hint">Select at least {MIN}</span>
        )}
        {atMax && <span className="ob-count-hint max">Maximum reached</span>}
      </div>

      <div className="ob-input-wrap">
        <span className="ob-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          className="ob-input"
          type="text"
          placeholder={atMax ? `Maximum ${MAX} ${step} reached` : placeholder}
          value={query}
          disabled={atMax}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
      </div>

      {focused && suggestions.length > 0 && (
        <ul className="ob-dropdown" ref={dropdownRef}>
          {suggestions.map((item) => (
            <li key={item} className="ob-dropdown-item" onMouseDown={() => handleSelect(item)}>
              <span className="ob-item-icon">{step === 'artists' ? '🎤' : '🎵'}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [step, setStep] = useState(0);
  const [artists, setArtists] = useState([]);
  const [genres, setGenres] = useState([]);
  const [allArtists, setAllArtists] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCsv(artistsCsv, 'artist').then(setAllArtists);
    loadCsv(genresCsv, 'genre').then(setAllGenres);
  }, []);

  const canContinue = artists.length >= MIN;
  const canFinish = artists.length >= MIN && genres.length >= MIN;

  const handleFinish = async () => {
    if (!canFinish) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/user/preferences', {
        fav_artists: artists,
        fav_genres: genres,
      });
      if (res.data.success) {
        setUser(res.data.user);
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const steps = ['Favourite Artists', 'Favourite Genres'];

  return (
    <div className="ob-root">
      <div className="ob-blob ob-blob-1" />
      <div className="ob-blob ob-blob-2" />
      <div className="ob-blob ob-blob-3" />

      <div className="ob-card">
        <div className="ob-header">
          <div className="ob-logo">♪</div>
          <h1 className="ob-title">Welcome to Rhythm</h1>
          <p className="ob-subtitle">
            Help us personalise your experience. Pick your favourites to get started.
          </p>
        </div>

        <div className="ob-steps">
          {steps.map((label, i) => (
            <React.Fragment key={label}>
              <div className={`ob-step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
                <div className="ob-step-circle">
                  {i < step ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className="ob-step-label">{label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`ob-step-line ${i < step ? 'done' : ''}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="ob-body">
          {step === 0 && (
            <>
              <h2 className="ob-section-title">🎤 Who do you vibe with?</h2>
              <p className="ob-section-desc">
                Search and select <strong>3–10 artists</strong> you love.
              </p>
              <SearchBox
                placeholder="Search artists…"
                allItems={allArtists}
                selected={artists}
                onAdd={(a) => setArtists((prev) => [...prev, a])}
                onRemove={(a) => setArtists((prev) => prev.filter((x) => x !== a))}
                step="artists"
              />
              <div className="ob-actions">
                <button className="ob-btn-primary" disabled={!canContinue} onClick={() => setStep(1)}>
                  Continue to Genres →
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="ob-section-title">🎵 What genres move you?</h2>
              <p className="ob-section-desc">
                Search and select <strong>3–10 genres</strong> you enjoy.
              </p>
              <SearchBox
                placeholder="Search genres…"
                allItems={allGenres}
                selected={genres}
                onAdd={(g) => setGenres((prev) => [...prev, g])}
                onRemove={(g) => setGenres((prev) => prev.filter((x) => x !== g))}
                step="genres"
              />
              {error && <p className="ob-error">{error}</p>}
              <div className="ob-actions">
                <button className="ob-btn-secondary" onClick={() => setStep(0)} disabled={loading}>
                  ← Back
                </button>
                <button className="ob-btn-primary" disabled={!canFinish || loading} onClick={handleFinish}>
                  {loading ? <span className="ob-spinner" /> : 'Finish Setup ✓'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
