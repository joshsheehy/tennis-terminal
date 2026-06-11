import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist must load from node_modules at runtime; bundling its legacy
  // build breaks worker/module resolution in the server runtime.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
