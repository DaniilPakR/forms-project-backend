const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/likes/check", async (req, res) => {
  try {
    const { userId, formId } = req.query;

    // Validate query parameters
    if (!userId || !formId) {
      return res.status(400).json({ error: "User ID and Form ID are required." });
    }

    // Query the database to check if the like exists
    const result = await pool.query(
      `SELECT 1 
       FROM likes 
       WHERE user_id = $1 AND form_id = $2`,
      [userId, formId]
    );

    // Check if a row was found
    if (result.rowCount > 0) {
      return res.status(200).json({ liked: true });
    } else {
      return res.status(200).json({ liked: false });
    }
  } catch (error) {
    console.error("Error checking like:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.post("/likes/add", async (req, res) => {
  try {
    const { form_id, user_id } = req.body;

    if (!form_id || !user_id) {
      return res.status(400).json({ error: "Form ID and User ID are required." });
    }

    await pool.query(
      `INSERT INTO likes (form_id, user_id) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING`, // Prevent duplicate likes
      [form_id, user_id]
    );

    res.status(201).json({ message: "Form liked successfully." });
  } catch (error) {
    console.error("Error liking form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.delete("/likes/delete", async (req, res) => {
  try {
    const { user_id, form_id } = req.body;

    // Validate input
    if (!user_id || !form_id) {
      return res.status(400).json({ error: "User ID and Form ID are required." });
    }

    // Delete the like
    const result = await pool.query(
      `DELETE FROM likes 
       WHERE user_id = $1 AND form_id = $2`,
      [user_id, form_id]
    );

    if (result.rowCount > 0) {
      return res.status(200).json({ message: "Like deleted successfully." });
    } else {
      return res.status(404).json({ error: "Like not found." });
    }
  } catch (error) {
    console.error("Error deleting like:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;