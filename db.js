const Pool = require("pg").Pool;

const pool = new Pool({
  user: "sanv",
  password: "Q40YZNSRkYFz9oyTALW1uNAGnoqzM2Sv",
  host: "dpg-ctofstbqf0us73ans68g-a.frankfurt-postgres.render.com", // Use full host
  port: 5432,
  database: "forms_641o",
  ssl: {
    rejectUnauthorized: false, // Required for Render's managed PostgreSQL
  },
});

module.exports = pool;
