

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("georoute_token") : null;
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${endpoint}`, {
    ...options,
    headers,
  });

    if (!response.ok) {
    let errorDetail = "Ocorreu um erro na requisição.";
    try {
      const errorData = await response.json();
      if (typeof errorData.detail === "string") {
        errorDetail = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        errorDetail = errorData.detail.map((d: any) => d.msg || JSON.stringify(d)).join(", ");
      } else if (errorData.detail) {
        errorDetail = JSON.stringify(errorData.detail);
      }
    } catch (e) {}
    throw new Error(errorDetail);
  }

  return response.json();
}

