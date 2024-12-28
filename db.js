const Pool = require("pg").Pool;

const pool = new Pool({
  user: "postgres",
  password: "parolka322",
  host: "51.20.3.194",
  port: 5432,
  database: "forms"
});

module.exports = pool;