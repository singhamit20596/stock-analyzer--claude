// The website build (netlify.toml sets VITE_READ_ONLY=1) only shows data: imports,
// edits and the paid assistant/news calls happen in the laptop app. The cloud
// API refuses every write anyway; this only keeps controls that cannot work off
// the screen. In the laptop app this is false and nothing changes.
export const READ_ONLY = import.meta.env.VITE_READ_ONLY === '1';
