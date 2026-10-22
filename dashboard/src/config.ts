import * as dotenv from 'dotenv';
import * as path from 'path';

// Shared project settings first, then dashboard-only settings (SQL login, port, dashboard login).
const root = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.dashboard'), override: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const schema = process.env.SQL_SCHEMA ?? 'PENERGY';
if (!/^[A-Z0-9_]+$/i.test(schema)) throw new Error(`SQL_SCHEMA must be a plain X3 folder name, got "${schema}"`);

function nrsConfig() {
  const env = (process.env.NRS_ENV ?? 'preprod').toLowerCase() === 'prod' ? 'prod' : 'preprod';
  const prefix = env === 'prod' ? 'NRS_PROD' : 'NRS_PREPROD';
  return {
    env,
    baseUrl: (process.env[`${prefix}_BASE_URL`] ?? '').replace(/\/+$/, ''),
    apiKey: process.env[`${prefix}_API_KEY`] ?? '',
    entityName: process.env.NRS_ENTITY_NAME ?? '',
    defaultHsnCode: process.env.NRS_DEFAULT_HSN_CODE ?? '',
    /** Sent when X3 has nothing better; the API rejects the invoice if these are left out. */
    defaults: {
      businessDescription: process.env.NRS_DEFAULT_BUSINESS_DESCRIPTION || 'Customer',
      city: process.env.NRS_DEFAULT_CITY || '',
      postalZone: process.env.NRS_DEFAULT_POSTAL_ZONE || '',
    },
    /** Stand-ins for missing customer email/phone/TIN. Only ever used in pre-prod. */
    placeholders:
      env === 'prod'
        ? { email: '', phone: '', tin: '' }
        : {
            email: process.env.NRS_PREPROD_PLACEHOLDER_EMAIL ?? '',
            phone: process.env.NRS_PREPROD_PLACEHOLDER_PHONE ?? '',
            tin: process.env.NRS_PREPROD_PLACEHOLDER_TIN ?? '',
          },
  };
}

export const config = {
  sql: {
    server: required('SQL_SERVER'),
    database: required('SQL_DATABASE'),
    user: required('SQL_USER'),
    password: required('SQL_PASSWORD'),
    schema,
  },
  dashboard: {
    host: process.env.DASHBOARD_HOST ?? '0.0.0.0',
    port: Number(process.env.DASHBOARD_PORT ?? '4100'),
    user: required('DASHBOARD_USER'),
    password: required('DASHBOARD_PASSWORD'),
    publicUrl: process.env.DASHBOARD_PUBLIC_URL ?? '',
  },
  nrs: nrsConfig(),
  dataDir: path.resolve(__dirname, '..', 'data'),
  edgePath: process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  assetsDir: path.resolve(__dirname, '..', 'assets'),
};
