const Pool = require("pg").Pool;

const pool = new Pool({
  user: "postgres",
  password: "parolka322",
  host: "localhost",
  port: 5432,
  database: "forms_project"
});

module.exports = pool;