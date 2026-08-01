// The content manifest used to be served from the deploy directory. It was the
// single most-requested path on the site (5,346 hits in 23h, still ~470/2h after
// removal) and it carried internal editorial notes. It now lives outside the
// deploy dir entirely — this returns a real 404 so the scraper stops getting a
// 200 with the SPA shell, which reads like "keep trying".
export function onRequest() {
  return new Response('Not found\n', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
