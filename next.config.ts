import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/products/:path*", destination: "/production/:path*", permanent: true },
      { source: "/products", destination: "/production", permanent: true },
      { source: "/admin/ingredients", destination: "/admin/inputs", permanent: true },
    ];
  },
};

export default withPWA(nextConfig);
