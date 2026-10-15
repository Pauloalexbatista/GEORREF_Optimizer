import type { NextConfig } from "next";
import path from "path";

const backendUrl = process.env.BACKEND_URL || "http://backend:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`, // Proxy to Backend
      },
    ];
  },
};

export default nextConfig;
