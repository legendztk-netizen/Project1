/**
 * Where the home page videos are served from: the public R2 bucket
 * `customhoseco-media`, connected to media.customhoseco.com (object keys
 * `video/<file>`). Poster images stay in `public/video` with the app.
 */
export const homeVideoBase = "https://media.customhoseco.com/video";

export const homeVideoUrl = (file: string) => `${homeVideoBase}/${file}`;
export const homePosterUrl = (file: string) => `/video/${file}`;
