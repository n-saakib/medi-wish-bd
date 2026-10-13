# next.config.ts

Keeps standalone output, disabled powered-by header and no-store staff/admin headers. Image optimization accepts only the configured API public-image path, refuses same-origin paths and redirects, emits WebP at quality 75 and bounds source bodies to 4 MiB. Loopback fetching is enabled only for an exact loopback API origin. minimumCacheTTL 60 and maximumDiskCacheSize 0 preserve the accepted takedown bound without a server-side image copy.
