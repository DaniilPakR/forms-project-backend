const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/latest/forms", async (req, res) => {
  try {
    const latestForms = await pool.query(
      `SELECT title, description, image, page_id 
       FROM forms 
       WHERE is_public = true
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    res.json({
      message: "Latest forms retrieved successfully",
      forms: latestForms.rows
    });
  } catch (error) {
    console.error("Error fetching latest forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/popular/forms", async (req, res) => {
  try {
    const popularForms = await pool.query(
      `SELECT f.form_id, f.title, f.description, f.image, f.page_id, COUNT(ff.filled_form_id) AS filled_count
       FROM forms f
       LEFT JOIN filled_forms ff ON f.form_id = ff.form_id
       WHERE f.is_public = true
       GROUP BY f.form_id, f.title, f.description, f.image, f.page_id
       ORDER BY filled_count DESC
       LIMIT 5`
    );

    res.json({
      message: "Top 5 popular forms retrieved successfully",
      forms: popularForms.rows
    });
  } catch (error) {
    console.error("Error fetching popular forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/forms/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userForms = await pool.query(
      `SELECT * FROM forms WHERE creator_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    if (userForms.rows.length === 0) {
      return res.status(404).json({ message: "No forms found for this user." });
    }

    res.json({
      message: "Forms retrieved successfully",
      forms: userForms.rows,
    });
  } catch (error) {
    console.error("Error fetching forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});


module.exports = router;