export interface ParsedConnection {
  engine: string;
  host: string;
  port: number | null;
  username: string;
  password: string;
  database: string;
}

const SCHEMES: Record<string, string> = {
  mysql: 'mysql',
  mariadb: 'mariadb',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mssql: 'mssql',
  sqlserver: 'mssql',
  sqlite: 'sqlite',
};

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Understands connection strings such as
 *   mysql://user:pass@host:3306/dbname
 *   postgresql+psycopg://user:pass@host/dbname
 *   sqlite:///C:/data/file.db
 * Returns null when the text isn't one.
 */
export function parseConnectionString(raw: string): ParsedConnection | null {
  const text = raw.trim();
  const schemeMatch = /^([a-z][a-z0-9]*)(?:\+[a-z0-9_]+)?:\/\//i.exec(text);
  if (!schemeMatch) return null;
  const engine = SCHEMES[schemeMatch[1].toLowerCase()];
  if (!engine) return null;

  if (engine === 'sqlite') {
    const path = text.replace(/^[a-z]+(?:\+[a-z0-9_]+)?:\/\/\//i, '');
    return path ? { engine, host: '', port: null, username: '', password: '', database: decode(path) } : null;
  }

  try {
    // new URL() only needs a known-safe scheme to split the parts for us.
    const url = new URL(text.replace(/^[a-z][a-z0-9]*(?:\+[a-z0-9_]+)?:\/\//i, 'db://'));
    if (!url.hostname) return null;
    return {
      engine,
      host: decode(url.hostname),
      port: url.port ? Number(url.port) : null,
      username: decode(url.username),
      password: decode(url.password),
      database: decode(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}
