const BLOCKED_COOKIE_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function decodeCookiePart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function parseCookies(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  const items = cookieHeader.split(';');

  for (const item of items) {
    const trimmed = item.trim();

    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const decodedName = decodeCookiePart(trimmed.slice(0, separator).trim());
    const decodedValue = decodeCookiePart(trimmed.slice(separator + 1).trim());

    if (!decodedName || decodedValue === undefined || BLOCKED_COOKIE_NAMES.has(decodedName)) {
      continue;
    }

    cookies[decodedName] = decodedValue;
  }

  return cookies;
}

function readJsonObjectCookie(cookieHeader: string | null, name: string): Record<string, any> {
  const raw = parseCookies(cookieHeader)[name];

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // A corrupt cookie is treated as absent so one bad value cannot 500 the route.
  }

  return {};
}

export function getApiKeysFromCookie(cookieHeader: string | null): Record<string, string> {
  return readJsonObjectCookie(cookieHeader, 'apiKeys');
}

export function getProviderSettingsFromCookie(cookieHeader: string | null): Record<string, any> {
  return readJsonObjectCookie(cookieHeader, 'providers');
}
