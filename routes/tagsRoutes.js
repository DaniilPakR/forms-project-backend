const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/tags", async (req, res) => {
  try {
    const tags = await pool.query(
      `SELECT tag_id, tag_text 
       FROM tags 
       ORDER BY tag_text ASC`
    );

    res.json({
      message: "Tags retrieved successfully",
      tags: tags.rows
    });
  } catch (error) {
    console.error("Error fetching tags:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Route to get all forms associated with a specific tag
router.get("/tags/:tagId/forms", async (req, res) => {
  const { tagId } = req.params;

  try {
    const forms = await pool.query(
      `SELECT f.form_id, f.title, f.description, f.image, f.page_id 
       FROM forms f
       INNER JOIN form_tags ft ON f.form_id = ft.form_id
       WHERE ft.tag_id = $1 AND f.is_public = true
       ORDER BY f.created_at DESC`,
      [tagId]
    );

    res.json({
      message: "Forms retrieved successfully for the tag",
      forms: forms.rows
    });
  } catch (error) {
    console.error("Error fetching forms for the tag:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;