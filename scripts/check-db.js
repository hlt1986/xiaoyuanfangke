const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'xiaoyuanfangke'
  });

  const [tables] = await connection.query('SHOW TABLES');
  const [[departments]] = await connection.query('SELECT COUNT(*) AS count FROM departments');
  const [[users]] = await connection.query('SELECT COUNT(*) AS count FROM users');
  const [[applications]] = await connection.query('SELECT COUNT(*) AS count FROM visitor_applications');
  const [userColumns] = await connection.query('SHOW COLUMNS FROM users');
  const [applicationColumns] = await connection.query('SHOW COLUMNS FROM visitor_applications');

  console.log(JSON.stringify({
    ok: true,
    tables: tables.length,
    departments: departments.count,
    users: users.count,
    applications: applications.count,
    userColumns: userColumns.map((item) => item.Field),
    applicationColumns: applicationColumns.map((item) => item.Field)
  }, null, 2));

  await connection.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
