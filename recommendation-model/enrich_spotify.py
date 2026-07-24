import pandas as pd
import requests
import time
import json
import os
import logging
import signal
import sys
import argparse

# ─── Config ──────────────────────────────────────────────────
INPUT_CSV       = 'processed_enriched_songs.csv'
OUTPUT_CSV      = 'processed_enriched_songs.csv'   # overwrite in place
CHECKPOINT_FILE = 'checkpoint.json'
FAILED_FILE     = 'failed_tracks.csv'
SAVE_EVERY      = 100
REQUEST_DELAY   = 0.3
MAX_RETRIES     = 3

# ─── Globals ─────────────────────────────────────────────────
current_index    = 0
current_df       = None
batch_start_time = None   # set when main loop begins

# ─── Logging (line-buffered for real-time tailing) ───────────
class FlushingStreamHandler(logging.StreamHandler):
    """StreamHandler that flushes after every record."""
    def emit(self, record):
        super().emit(record)
        self.flush()

# Line-buffered file (buffering=1) → each newline flushes to disk
_log_file = open('enrichment.log', 'a', buffering=1, encoding='utf-8')
_file_handler   = logging.StreamHandler(_log_file)
_file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
_stream_handler = FlushingStreamHandler(sys.stdout)
_stream_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))

logging.root.setLevel(logging.INFO)
logging.root.handlers = [_file_handler, _stream_handler]
log = logging.getLogger(__name__)

# ─── Argument parser ─────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument('--status', action='store_true', help='Show current progress')
parser.add_argument('--reset',  action='store_true', help='Reset checkpoint and start over')
args = parser.parse_args()

# ─── Spotify Client Credentials (entered at runtime) ─────────
def prompt_credentials():
    print('─' * 50)
    print('  Spotify API Credentials')
    print('─' * 50)
    client_id     = input('Enter SPOTIFY_CLIENT_ID     : ').strip()
    client_secret = input('Enter SPOTIFY_CLIENT_SECRET : ').strip()
    if not client_id or not client_secret:
        print('Error: credentials cannot be empty.')
        sys.exit(1)
    return client_id, client_secret

# ─── Spotify token fetch ──────────────────────────────────────
def get_access_token(client_id, client_secret):
    response = requests.post(
        'https://accounts.spotify.com/api/token',
        data={'grant_type': 'client_credentials'},
        auth=(client_id, client_secret),
        timeout=10
    )
    response.raise_for_status()
    data = response.json()
    log.info('Got new Spotify access token')
    return data['access_token'], time.time() + data['expires_in'] - 60

# ─── Token manager ────────────────────────────────────────────
class TokenManager:
    def __init__(self, client_id, client_secret):
        self.client_id     = client_id
        self.client_secret = client_secret
        self.token         = None
        self.expires_at    = 0

    def get(self):
        if time.time() >= self.expires_at:
            self.token, self.expires_at = get_access_token(self.client_id, self.client_secret)
        return self.token

# Will be initialised in main() after credentials are entered
token_manager = None

# ─── Search Spotify ───────────────────────────────────────────
def search_track(track_name, artist_name, retry=0):
    try:
        token = token_manager.get()
        q = f'track:{track_name} artist:{artist_name}' if artist_name else f'track:{track_name}'

        response = requests.get(
            'https://api.spotify.com/v1/search',
            headers={'Authorization': f'Bearer {token}'},
            params={
                'q':     q,
                'type':  'track',
                'limit': 1
            },
            timeout=10
        )

        # Rate limited
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 5))
            log.warning(f'Rate limited. Waiting {retry_after}s...')
            time.sleep(retry_after)
            return search_track(track_name, artist_name, retry)

        # Token expired
        if response.status_code == 401:
            log.warning('Token expired mid-run, refreshing...')
            token_manager.expires_at = 0
            return search_track(track_name, artist_name, retry)

        # Server error
        if response.status_code >= 500:
            if retry < MAX_RETRIES:
                wait = 2 ** retry
                log.warning(f'Server error {response.status_code}. Retry {retry+1}/{MAX_RETRIES} in {wait}s...')
                time.sleep(wait)
                return search_track(track_name, artist_name, retry + 1)
            else:
                log.error(f'Max retries hit for "{track_name}" by "{artist_name}"')
                return None, None

        response.raise_for_status()
        data  = response.json()
        items = data.get('tracks', {}).get('items', [])

        if not items:
            return None, None

        track     = items[0]
        track_id  = track['id']
        images    = track.get('album', {}).get('images', [])
        image_url = images[0]['url'] if images else None

        return track_id, image_url

    except requests.exceptions.ConnectionError:
        if retry < MAX_RETRIES:
            wait = 2 ** retry
            log.warning(f'Connection error. Retry {retry+1}/{MAX_RETRIES} in {wait}s...')
            time.sleep(wait)
            return search_track(track_name, artist_name, retry + 1)
        log.error(f'Connection failed after {MAX_RETRIES} retries for "{track_name}"')
        return None, None

    except requests.exceptions.Timeout:
        if retry < MAX_RETRIES:
            log.warning(f'Timeout. Retry {retry+1}/{MAX_RETRIES}...')
            time.sleep(2)
            return search_track(track_name, artist_name, retry + 1)
        return None, None

    except Exception as e:
        log.error(f'Unexpected error for "{track_name}": {e}')
        return None, None

# ─── Checkpoint helpers ───────────────────────────────────────
def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, 'r') as f:
            data = json.load(f)
            log.info(f'Resuming from checkpoint: {data["processed"]} tracks already done')
            return data['processed']
    return 0

def save_checkpoint(processed):
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump({'processed': processed}, f)

# ─── Safe CSV write (temp-file + rename, avoids PermissionError) ─
def safe_write_csv(df, path=OUTPUT_CSV):
    """Write df to a temp file beside 'path', then atomically replace it.
    Returns True on success, False if the file is locked by another app."""
    tmp = path + '.tmp'
    try:
        df.to_csv(tmp, index=False)
        os.replace(tmp, path)   # atomic on Windows when on same drive
        return True
    except PermissionError:
        log.error(
            f'Cannot write to {path} — close it in Excel/any other app, '
            'then press Enter to retry...'
        )
        input('Press Enter once the file is closed: ')
        try:
            df.to_csv(tmp, index=False)
            os.replace(tmp, path)
            return True
        except Exception as e:
            log.error(f'Still cannot write: {e}')
            return False
    except Exception as e:
        log.error(f'Unexpected error writing CSV: {e}')
        if os.path.exists(tmp):
            os.remove(tmp)
        return False

# ─── Graceful shutdown on Ctrl+C ─────────────────────────────
def handle_interrupt(sig, frame):
    log.info('Interrupted! Saving progress before exit...')
    if current_df is not None:
        if safe_write_csv(current_df):
            save_checkpoint(current_index)
            log.info(f'Saved at row {current_index}. Run script again to resume.')
        else:
            log.error('Could not save — progress for this batch may be lost.')
    sys.exit(0)

signal.signal(signal.SIGINT, handle_interrupt)

# ─── Status command ───────────────────────────────────────────
if args.status:
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            data = json.load(f)
        total = len(pd.read_csv(INPUT_CSV))
        done  = data['processed']
        pct   = (done / total) * 100
        print(f'Progress  : {done:,} / {total:,} ({pct:.1f}%)')
        print(f'Remaining : {total - done:,} tracks')
        print(f'Est. left : {((total - done) * REQUEST_DELAY / 3600):.1f} hours')
    else:
        print('No checkpoint found. Script has not been run yet.')
    sys.exit(0)

# ─── Reset command ────────────────────────────────────────────
if args.reset:
    confirm = input('Are you sure you want to reset all progress? (yes/no): ')
    if confirm.lower() == 'yes':
        if os.path.exists(CHECKPOINT_FILE): os.remove(CHECKPOINT_FILE)
        if os.path.exists(FAILED_FILE):     os.remove(FAILED_FILE)
        # Strip enrichment columns from the CSV
        if os.path.exists(OUTPUT_CSV):
            df = pd.read_csv(OUTPUT_CSV)
            for col in ('spotify_track_id', 'banner_image'):
                if col in df.columns:
                    df.drop(columns=[col], inplace=True)
            df.to_csv(OUTPUT_CSV, index=False)
        print('Reset complete. Run script normally to start fresh.')
    sys.exit(0)

# ─── Main ─────────────────────────────────────────────────────
def main():
    global current_index, current_df, token_manager

    # Ask for credentials at startup
    client_id, client_secret = prompt_credentials()
    token_manager = TokenManager(client_id, client_secret)

    # ── Column names in processed_enriched_songs.csv ──
    # song       → track name
    # Artist(s)  → artist name(s)

    df = pd.read_csv(INPUT_CSV)
    log.info(f'Loaded {len(df)} tracks from {INPUT_CSV}')

    # Add output columns if not present
    if 'spotify_track_id' not in df.columns:
        df['spotify_track_id'] = None
    if 'banner_image' not in df.columns:
        df['banner_image'] = None

    # Load checkpoint
    start_index = load_checkpoint()

    # Merge already-enriched data if resuming
    if os.path.exists(OUTPUT_CSV) and start_index > 0:
        existing = pd.read_csv(OUTPUT_CSV)
        if 'spotify_track_id' in existing.columns:
            df['spotify_track_id'] = existing['spotify_track_id']
        if 'banner_image' in existing.columns:
            df['banner_image'] = existing['banner_image']
        log.info(f'Loaded existing output, resuming from index {start_index}')

    global batch_start_time
    failed_rows      = []
    batch_start_time = time.time()

    for i in range(start_index, len(df)):
        current_index = i
        current_df    = df

        row         = df.iloc[i]
        track_name  = str(row.get('song',      '')).strip()
        artist_name = str(row.get('Artist(s)', '')).strip()

        # Skip empty rows
        if not track_name:
            log.warning(f'Row {i}: missing song name, skipping')
            continue

        # Skip already populated rows
        existing_id = df.at[i, 'spotify_track_id']
        if pd.notna(existing_id) and str(existing_id).strip():
            continue

        track_id, image_url = search_track(track_name, artist_name)

        if track_id:
            df.at[i, 'spotify_track_id'] = track_id
            df.at[i, 'banner_image']     = image_url
            log.debug(f'Row {i}: Found "{track_name}" → {track_id}')
        else:
            log.warning(f'Row {i}: Not found — "{track_name}" by "{artist_name}"')
            failed_rows.append({
                'index':       i,
                'track_name':  track_name,
                'artist_name': artist_name
            })

        # ── Rich progress banner every 100 tracks ──────────────
        if (i + 1) % 100 == 0:
            total      = len(df)
            done       = i + 1 - start_index          # tracks processed this session
            pct        = ((i + 1) / total) * 100
            elapsed    = time.time() - batch_start_time
            rate       = done / elapsed if elapsed > 0 else 0   # tracks/sec
            remaining  = total - (i + 1)
            eta_sec    = remaining / rate if rate > 0 else float('inf')
            eta_h      = int(eta_sec // 3600)
            eta_m      = int((eta_sec % 3600) // 60)
            success    = (done - len(failed_rows)) / done * 100 if done > 0 else 0
            log.info(
                '─' * 60 + '\n'
                f'  PROGRESS   : {i+1:,} / {total:,}  ({pct:.2f}%)\n'
                f'  REMAINING  : {remaining:,} tracks\n'
                f'  SPEED      : {rate * 60:.1f} tracks/min\n'
                f'  ETA        : {eta_h}h {eta_m:02d}m\n'
                f'  ELAPSED    : {int(elapsed // 3600)}h {int((elapsed % 3600) // 60):02d}m {int(elapsed % 60):02d}s\n'
                f'  SUCCESS    : {success:.1f}%  |  FAILED: {len(failed_rows):,}\n'
                + '─' * 60
            )

        # Save checkpoint every SAVE_EVERY tracks
        if (i + 1) % SAVE_EVERY == 0:
            if safe_write_csv(df):
                save_checkpoint(i + 1)
                log.info(f'Checkpoint saved at {i+1}')
            else:
                log.warning(f'Skipped checkpoint at {i+1} due to write failure')

        time.sleep(REQUEST_DELAY)

    # Final save
    if safe_write_csv(df):
        save_checkpoint(len(df))
    log.info(f'Done. Output saved to {OUTPUT_CSV}')
    log.info(f'Total processed: {len(df):,} | Failed: {len(failed_rows):,}')

    # Save failed tracks
    if failed_rows:
        failed_df = pd.DataFrame(failed_rows)
        failed_df.to_csv(FAILED_FILE, index=False)
        log.info(f'{len(failed_rows):,} tracks failed — saved to {FAILED_FILE}')

        retry = input(f'\n{len(failed_rows)} tracks failed. Retry them now? (yes/no): ')
        if retry.lower() == 'yes':
            retry_failed()
    else:
        log.info('All tracks found successfully — no failures!')

# ─── Retry failed tracks ──────────────────────────────────────
def retry_failed():
    if not os.path.exists(FAILED_FILE):
        log.info('No failed tracks file found.')
        return

    failed_df = pd.read_csv(FAILED_FILE)
    output_df = pd.read_csv(OUTPUT_CSV)
    log.info(f'Retrying {len(failed_df)} failed tracks...')

    still_failed = []

    for i, row in failed_df.iterrows():
        track_name  = str(row['track_name']).strip()
        artist_name = str(row['artist_name']).strip()
        original_i  = int(row['index'])

        track_id, image_url = search_track(track_name, artist_name)

        if not track_id:
            log.info(f'Retrying "{track_name}" without artist filter...')
            track_id, image_url = search_track(track_name, '')

        if track_id:
            output_df.at[original_i, 'spotify_track_id'] = track_id
            output_df.at[original_i, 'banner_image']     = image_url
            log.info(f'Retry success: "{track_name}" → {track_id}')
        else:
            still_failed.append(row.to_dict())
            log.warning(f'Retry failed: "{track_name}" by "{artist_name}"')

        time.sleep(REQUEST_DELAY)

    safe_write_csv(output_df)

    if still_failed:
        pd.DataFrame(still_failed).to_csv(FAILED_FILE, index=False)
        log.info(f'Still failed after retry: {len(still_failed)} tracks saved to {FAILED_FILE}')
    else:
        os.remove(FAILED_FILE)
        log.info('All previously failed tracks found on retry!')

# ─── Entry point ─────────────────────────────────────────────
if __name__ == '__main__':
    main()
