export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    // If running on localhost / 127.0.0.1, connect directly to FastAPI port 8000 to eliminate Node proxy timeouts
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://127.0.0.1:8000";
    }
  }
  return "";
}

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("georoute_token") : null;
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const baseUrl = getApiBaseUrl();
  const fullUrl = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      headers,
    });
  } catch (netErr: any) {
    throw new Error(netErr.message || "Erro de ligação ao servidor.");
  }

  if (!response.ok) {
    let errorDetail = "Ocorreu um erro no processamento da requisição.";
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const errorData = await response.json();
        if (typeof errorData.detail === "string") {
          errorDetail = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          errorDetail = errorData.detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ");
        } else if (errorData.detail) {
          errorDetail = JSON.stringify(errorData.detail);
        }
      } else {
        const rawText = await response.text();
        if (rawText && rawText.length < 200 && !rawText.includes("<!DOCTYPE") && !rawText.includes("<html")) {
          errorDetail = rawText;
        } else if (response.status === 504 || response.status === 502) {
          errorDetail = "O servidor demorou demasiado tempo a responder (Timeout).";
        } else {
          errorDetail = `Erro no servidor (Código ${response.status}).`;
        }
      }
    } catch (e) {}
    
    const error: any = new Error(errorDetail);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export const api = {
  get: async (endpoint: string, options: RequestInit = {}) => {
    const res = await apiRequest(endpoint, { ...options, method: "GET" });
    return res;
  },
  post: async (endpoint: string, body?: any, options: RequestInit = {}) => {
    const res = await apiRequest(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    return res;
  },
  put: async (endpoint: string, body?: any, options: RequestInit = {}) => {
    const res = await apiRequest(endpoint, {
      ...options,
      method: "PUT",
      body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    return res;
  },
  delete: async (endpoint: string, options: RequestInit = {}) => {
    const res = await apiRequest(endpoint, { ...options, method: "DELETE" });
    return res;
  },
  download: async (endpoint: string, filename: string) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("georoute_token") : null;
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const baseUrl = getApiBaseUrl();
    const fullUrl = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const response = await fetch(fullUrl, { headers });
    if (!response.ok) {
      throw new Error("Erro ao descarregar ficheiro.");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default api;
