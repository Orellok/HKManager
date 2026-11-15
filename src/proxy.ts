import { NextResponse, type NextRequest } from "next/server";

import {
  NONCE_REQUEST_HEADER,
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security-headers";

const CSP_HEADER = "Content-Security-Policy";

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
  });

  // Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_REQUEST_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      // Static build assets carry no inline code and need no nonce.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
