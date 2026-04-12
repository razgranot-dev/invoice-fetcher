import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Python worker proxy (Phase 2)
  // async rewrites() {
  //   return [
  //     { source: "/api/worker/:path*", destination: "http://localhost:8000/:path*" },
  //   ];
  // },
};

export default nextConfig;
