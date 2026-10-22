/**
 * Ad-hoc helper: hits a candidate Sage X3 endpoint and prints the raw response so the
 * real field names can be confirmed and src/sage/fetchDocuments.ts finished.
 *
 * Usage: SAGE_INSPECT_PATH=/some/path npm run sage:inspect
 */
import { sageHttp } from './client';

async function main() {
  const targetPath = process.env.SAGE_INSPECT_PATH;
  if (!targetPath) {
    console.error('Set SAGE_INSPECT_PATH to the endpoint you want to inspect, e.g.:');
    console.error('  SAGE_INSPECT_PATH=/some/candidate/path npm run sage:inspect');
    process.exit(1);
  }
  try {
    const res = await sageHttp.get(targetPath);
    console.log('Status:', res.status);
    console.log(JSON.stringify(res.data, null, 2).slice(0, 5000));
  } catch (err: any) {
    console.error('Request failed:', err.response?.status, err.response?.data ?? err.message);
    process.exit(1);
  }
}

main();
