/**
 * Cloudflare Pages middleware — runs on every request to the project.
 *
 * Canonicalizes the host: any request to www.brain4machinery.com is 301'd
 * to the apex (brain4machinery.com), preserving path, query, and fragment.
 *
 * Cloudflare Pages' _redirects file does NOT support hostname-based source
 * matching (the source path must begin with `/`), so the host canonicalization
 * has to live here.
 */
export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);

  if (url.hostname === 'www.brain4machinery.com') {
    url.hostname = 'brain4machinery.com';
    return Response.redirect(url.toString(), 301);
  }

  return next();
};
