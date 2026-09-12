export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown' },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  );
}
