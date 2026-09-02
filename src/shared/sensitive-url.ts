const compactSensitiveQueryNames = new Set([
  "auth", "authentication", "authorization", "key", "apikey", "accesskey",
  "sig", "signature", "token", "accesstoken", "refreshtoken", "idtoken",
  "secret", "clientsecret", "password", "passwd", "credential", "credentials",
]);

function compactQueryName(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveQueryParameter(name: string): boolean {
  const normalized = name.normalize("NFKC").toLocaleLowerCase();
  const compact = compactQueryName(normalized);
  return compactSensitiveQueryNames.has(compact) ||
    /(?:auth|token|secret|password|passwd|credential|signature|apikey|accesskey)$/.test(compact);
}

export function hasSensitiveUrlQuery(raw: string): boolean {
  try {
    return [...new URL(raw).searchParams.keys()].some(isSensitiveQueryParameter);
  } catch {
    return true;
  }
}

export function sanitizeSensitiveUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return "[REDACTED URL]"; }
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitiveQueryParameter(name)) url.searchParams.delete(name);
  }
  url.hash = "";
  return url.toString();
}
