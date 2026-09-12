import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Quran Classification',
    short_name: 'Quran',
    description:
      'Read the Quran in a page-perfect Mushaf layout, annotate verses, and organise them into topics.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fdfaf3',
    theme_color: '#8a6d3b',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
