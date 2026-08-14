export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options: RequestInit = init ? { ...init } : {};

  // @ts-ignore
  const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : undefined;
  if (initData) {
    const headers = new Headers(options.headers || {});
    headers.set('X-Telegram-Init-Data', initData);
    options.headers = headers;
  }

  return fetch(input, options);
}

/**
 * Triggers native Telegram WebApp haptic vibration feedback on mobile devices
 */
export function triggerHaptic(type: 'success' | 'warning' | 'error' | 'light' | 'medium' = 'success') {
  try {
    // @ts-ignore
    const hf = typeof window !== 'undefined' ? window.Telegram?.WebApp?.HapticFeedback : null;
    if (!hf) return;
    if (type === 'success' || type === 'warning' || type === 'error') {
      hf.notificationOccurred(type);
    } else {
      hf.impactOccurred(type);
    }
  } catch (e) {
    // Ignore if not supported
  }
}

