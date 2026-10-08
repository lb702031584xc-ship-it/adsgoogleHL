/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone disabled on Windows hosts (symlink EPERM). Docker image uses full next start.
  eslint: {
    // ESLint config is incomplete in this repo (missing react-hooks plugin);
    // type checking via tsc covers correctness. Disable lint during builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
