/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint is enforced at the workspace root (eslint + prettier in the
  // engram-code package). Next would otherwise pull in an inherited
  // prettier ruleset and double-report.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
