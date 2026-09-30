/**
 * Where the home page videos are served from. They live in `public/video` for
 * now; after uploading them to Cloudflare (for example an R2 bucket on
 * media.customhoseco.com) set this to that origin and path, e.g.
 * "https://media.customhoseco.com/video". Poster images stay local.
 */
export const homeVideoBase = "/video";

export const homeVideoUrl = (file: string) => `${homeVideoBase}/${file}`;
export const homePosterUrl = (file: string) => `/video/${file}`;
