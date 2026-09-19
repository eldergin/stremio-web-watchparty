// Copyright (C) 2017-2026 Smart code 203358507

const DEFAULT_SERVER_URL = 'https://weights-decisions-boxing-litigation.trycloudflare.com';

// asks the sync server to store the (very long) invite url under a short code;
// resolves to a short link, or null so callers can fall back to the full url
const createShortLink = async (serverUrl: string, longUrl: string): Promise<string | null> => {
    try {
        const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/short`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: longUrl }),
        });
        if (!response.ok) {
            return null;
        }
        const { code } = await response.json();
        return typeof code === 'string' && code ? `${window.location.origin}/?s=${encodeURIComponent(code)}` : null;
    } catch {
        return null;
    }
};

// if the page was opened via a short link (?s=CODE), swap it for the stored full url
const resolveShortLink = async (serverUrl: string = DEFAULT_SERVER_URL): Promise<void> => {
    const code = new URLSearchParams(window.location.search).get('s');
    if (!code) {
        return;
    }
    try {
        const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/short/${encodeURIComponent(code)}`);
        if (!response.ok) {
            return;
        }
        const { url } = await response.json();
        if (typeof url === 'string' && url.startsWith(window.location.origin)) {
            window.location.replace(url);
        }
    } catch {
        // leave the page as is; the app just opens normally
    }
};

export { DEFAULT_SERVER_URL, createShortLink, resolveShortLink };
