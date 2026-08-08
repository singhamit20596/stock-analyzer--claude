// Login token handling, and the one place API requests get authenticated.
//
// Rather than thread a token through twenty-five `fetch` call sites — where a
// single missed one is a silent 401 — the app's own API calls are wrapped once
// at startup. Only same-origin `/api` requests are touched; anything else goes
// through untouched.

const TOKEN_KEY = 'authToken';
const VIEW_AS_KEY = 'viewAsUserId';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** The user an admin is currently looking at, if any. */
export const getViewAs = () => localStorage.getItem(VIEW_AS_KEY);
export const setViewAs = (userId) =>
  userId ? localStorage.setItem(VIEW_AS_KEY, userId) : localStorage.removeItem(VIEW_AS_KEY);
export const clearViewAs = () => localStorage.removeItem(VIEW_AS_KEY);

export function signOutLocally() {
  clearToken();
  clearViewAs();
}

let unauthorizedHandler = () => {};
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const isApiUrl = (url) =>
  typeof url === 'string' &&
  (url.startsWith('/api') || url.startsWith(`${window.location.origin}/api`));

export function installAuthFetch() {
  const original = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (!isApiUrl(url)) return original(input, init);

    const headers = new Headers(init.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // Sending the header on writes too lets the server reject them, which is
    // what keeps "view as" read-only rather than trusting the UI to hide
    // the buttons.
    const viewAs = getViewAs();
    if (viewAs) headers.set('X-View-As', viewAs);

    const response = await original(input, { ...init, headers });
    if (response.status === 401) unauthorizedHandler();
    return response;
  };
}

export async function login(username, password) {
  return submitCredentials('/api/auth/login', username, password);
}

export async function register(username, password) {
  return submitCredentials('/api/auth/register', username, password);
}

async function submitCredentials(path, username, password) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || 'Something went wrong. Try again.');
  setToken(body.token);
  clearViewAs();
  return body;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Signing out locally matters more than telling the server about it.
  }
  signOutLocally();
}
