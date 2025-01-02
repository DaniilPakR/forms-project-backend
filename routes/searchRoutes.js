const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/forms/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required." });
    }

    const searchTerm = `%${query}%`; // For LIKE operator with partial matching

    // Query to search across multiple tables for related data
    const searchResults = await pool.query(
      `
      SELECT DISTINCT f.form_id, f.page_id, f.title
      FROM forms f
      LEFT JOIN questions q ON f.form_id = q.form_id
      LEFT JOIN answer_options ao ON q.question_id = ao.question_id
      LEFT JOIN form_tags ft ON f.form_id = ft.form_id
      LEFT JOIN tags t ON ft.tag_id = t.tag_id
      WHERE 
        f.title ILIKE $1 OR
        f.description ILIKE $1 OR
        f.topic ILIKE $1 OR
        q.question_text ILIKE $1 OR
        ao.option_text ILIKE $1 OR
        t.tag_text ILIKE $1
      `,
      [searchTerm]
    );

    if (searchResults.rows.length === 0) {
      return res.status(404).json({ message: "No matching forms found." });
    }

    res.status(200).json(searchResults.rows);
  } catch (error) {
    console.error("Error fetching search results:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/tags/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ error: "Query parameter is required." });
    }

    const tags = await pool.query(
      `SELECT * FROM tags WHERE tag_text ILIKE $1`,
      [`%${query}%`]
    );

    res.status(200).json(tags.rows);
  } catch (error) {
    console.error("Error searching tags:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;