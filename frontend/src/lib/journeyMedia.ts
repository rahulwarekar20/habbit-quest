/** Public, versioned product media. These URLs contain no credentials. */
const JOURNEY_MEDIA_BASE = "https://habbit-quest-assets.s3.us-east-1.amazonaws.com/videos/habitquest-journey/46f25482681172e1";

export const JOURNEY_MEDIA = {
  video: `${JOURNEY_MEDIA_BASE}/habitquest-product-overview-1080p.mp4`,
  poster: `${JOURNEY_MEDIA_BASE}/poster.jpg`,
  captions: `${JOURNEY_MEDIA_BASE}/captions.vtt`,
} as const;
