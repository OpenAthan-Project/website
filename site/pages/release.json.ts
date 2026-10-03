import { metadata, siteSelection } from '../release-selection';
export async function GET() {
  return new Response(JSON.stringify(metadata(await siteSelection())) + '\n', {
    headers: { 'Content-Type': 'application/json' },
  });
}
