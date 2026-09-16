const QUL_RESOURCE_URL = 'https://qul.tarteel.ai/resources/mushaf-layout/569';

export async function GET(_request: Request, context: RouteContext<'/api/mushaf-page/[page]'>) {
  const { page: rawPage } = await context.params;
  const page = Number(rawPage);

  if (!Number.isInteger(page) || page < 1 || page > 604) {
    return new Response('Invalid Quran page', { status: 400 });
  }

  try {
    // QUL resource 569 publishes each of the 604 pages as semantic inline SVG.
    // Keep this server-side so browsers are not blocked by cross-origin rules,
    // and let the platform cache the immutable page response at the edge.
    const upstream = await fetch(`${QUL_RESOURCE_URL}?page=${page}`, {
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!upstream.ok) throw new Error(`QUL returned ${upstream.status}`);

    const html = await upstream.text();
    const pageId = `id="Mushaf_Page_${String(page).padStart(3, '0')}"`;
    const idAt = html.indexOf(pageId);
    const start = idAt < 0 ? -1 : html.lastIndexOf('<svg', idAt);
    const endAt = start < 0 ? -1 : html.indexOf('</svg>', idAt);
    if (start < 0 || endAt < 0) throw new Error('QUL page SVG was not found');

    const svg = html.slice(start, endAt + '</svg>'.length);
    if (!svg.includes('id="md-page-inner"')) throw new Error('QUL page SVG is invalid');

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error(`[mushaf] unable to retrieve SVG page ${page}`, error);
    return new Response(`Quran page ${page} is temporarily unavailable`, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
