import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "vite",
  buildCommand: "npx vite build",
  fluid: true,
  regions: ["iad1"],
  headers: [
    {
      source: "/api/v1/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ],
};
