import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_DSN,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
});
