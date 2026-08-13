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
