// Relative paths only -- Vite's dev-server proxy (vite.config.ts) forwards
// /api and /health to the API, which keeps everything same-origin from the
// browser's point of view. That matters specifically for the auth cookie:
// a cross-origin setup would need CORS + credentials configuration this
// sidesteps entirely.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // FormData bodies must NOT get a manual Content-Type -- the browser sets
  // one itself (multipart/form-data; boundary=...) and only knows the
  // correct boundary value when it does this automatically.
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    // Only set Content-Type when there's actually a JSON body -- Fastify's
    // JSON body parser rejects an empty body sent with this header (DELETE
    // and body-less POSTs like cancel/rerun hit this).
    headers: options?.body && !isFormData ? { 'Content-Type': 'application/json', ...options?.headers } : options?.headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = body?.issues
      ? body.issues.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join('; ')
      : body?.message || body?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', body: formData }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
