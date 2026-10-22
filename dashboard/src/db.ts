import sql from 'mssql';
import { config } from './config';

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function pool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    // "HOST\INSTANCE" is a named instance; mssql wants them split.
    const [server, instanceName] = config.sql.server.split('\\');
    poolPromise = new sql.ConnectionPool({
      server,
      database: config.sql.database,
      user: config.sql.user,
      password: config.sql.password,
      options: { instanceName, encrypt: false, trustServerCertificate: true },
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    })
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

/** Prefix an X3 table with the folder schema, e.g. t('SINVOICE') -> [PENERGY].[SINVOICE]. */
export function t(table: string): string {
  return `[${config.sql.schema}].[${table}]`;
}

export { sql };
