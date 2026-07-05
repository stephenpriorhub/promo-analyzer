import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: {
    // Next 16 caps request bodies at 10MB by default; large promo PDFs
    // exceed that and the truncated body fails FormData parsing.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
