import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  experimental: {
    // 只保留实际被引用的包。date-fns / framer-motion / react-syntax-highlighter
    // 全 src 零引用，recharts 仅被未被任何模块 import 的 ui/chart.tsx 引用，
    // 写在这里不产生任何优化收益。
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
