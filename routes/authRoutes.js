const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/auth/register", async (req, res) => {
  console.log("Hi", req.body)
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const newUser = await pool.query(
      `INSERT INTO users (user_name, user_email, user_password, created_at, updated_at) 
       VALUES ($1, $2, $3, NOW(), NOW()) 
       RETURNING *`,
      [name, email, password]
    );

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser.rows[0].user_id,
        name: newUser.rows[0].user_name,
        email: newUser.rows[0].user_email,
      },
    });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Error during registration:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE user_email = $1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (password !== user.rows[0].user_password) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.rows[0].user_id,
        name: user.rows[0].user_name,
        email: user.rows[0].user_email,
        is_admin: user.rows[0].is_admin,
        is_blocked: user.rows[0].is_blocked,
      },
    });
  } catch (e) {
    console.error("Error during login:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;