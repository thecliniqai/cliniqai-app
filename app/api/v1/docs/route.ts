import { NextResponse } from "next/server";
import { apiV1Enabled } from "@/lib/api/enabled";
import { apiV1NotFound } from "@/lib/api/auth";

/**
 * Interactive developer API documentation viewer per D-07.
 * Uses official pinned Scalar standalone script (@1.25.101) via CDN.
 * Avoids third-party npm packages; strictly renders light mode ('darkMode: false') per DESIGN.md.
 */
export async function GET() {
  // Off with the `/api/v1` switch (AR2-H2: checked here as well as in the middleware).
  if (!apiV1Enabled()) return apiV1NotFound();
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ClinicQ Developer REST API — Documentation</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #ffffff;
      }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      type="application/json"
      data-url="/api/v1/openapi.json"
      data-configuration='{"darkMode":false,"theme":"default","showSidebar":true}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.101"></script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
