export const PROTECTION_NETLIFY = 'netlify';

export const NETLIFY_PROTECTED_MESSAGE = 'this Netlify site is password-protected; upload its icon or remove protection';

export const netlifyProtection = (status, header) => {
  if (header('netlify-site-protection-expires-in')) return status < 200 || status >= 300 ? PROTECTION_NETLIFY : null;
  if (status === 401 && (/netlify/i.test(header('server') || '') || header('x-nf-request-id'))) return PROTECTION_NETLIFY;
  return null;
};

export const headersReader = (headers) => (name) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) return String(headers[key]);
  return null;
};
